import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { keys } from './api/queries'
import type { Spot, SpotState } from './api/types'

export type Connection = 'connecting' | 'online' | 'offline'

/**
 * socket.io → TanStack Query cache (ARCHITECTURE §4). spot.updated patches
 * the map in place, dropping stale versions; anything that could have been
 * missed (reconnect, sync.required) refetches the snapshot.
 */
export function useRealtime(token: string | null): Connection {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Connection>('connecting')

  useEffect(() => {
    if (!token) return
    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] })
    const resync = () => void qc.invalidateQueries()

    socket.on('session.ready', () => {
      setStatus('online')
      resync()
    })
    socket.on('disconnect', () => setStatus('offline'))
    socket.on('connect_error', () => setStatus('offline'))
    socket.on('sync.required', resync)
    socket.on('spot.updated', (e: { spotId: string; state: SpotState; version: number }) => {
      qc.setQueryData<Spot[]>(keys.spots, (old) =>
        old?.map((s) => (s.id === e.spotId && e.version > s.version ? { ...s, state: e.state, version: e.version } : s)),
      )
    })
    socket.on('booking.updated', () => void qc.invalidateQueries({ queryKey: keys.bookings }))
    socket.on('visit.updated', () => {
      void qc.invalidateQueries({ queryKey: keys.visits })
      void qc.invalidateQueries({ queryKey: keys.invoices })
      void qc.invalidateQueries({ queryKey: keys.operatorVisits })
      void qc.invalidateQueries({ queryKey: keys.gateEvents })
    })
    socket.on('anomaly.created', () => void qc.invalidateQueries({ queryKey: keys.anomalies }))
    return () => {
      socket.disconnect()
    }
  }, [token, qc])

  return status
}
