import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Anomaly, Booking, GateEvent, Invoice, Me, Spot, Visit } from './types'

export const keys = {
  spots: ['spots'],
  me: ['me'],
  bookings: ['bookings'],
  visits: ['visits'],
  invoices: ['invoices'],
  operatorVisits: ['operator', 'visits'],
  anomalies: ['operator', 'anomalies'],
  gateEvents: ['operator', 'gate-events'],
} as const

export const useSpots = () => useQuery({ queryKey: keys.spots, queryFn: () => api<Spot[]>('/spots') })
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/me') })
export const useBookings = () => useQuery({ queryKey: keys.bookings, queryFn: () => api<Booking[]>('/bookings') })
export const useVisits = () => useQuery({ queryKey: keys.visits, queryFn: () => api<Visit[]>('/visits') })
export const useInvoices = () => useQuery({ queryKey: keys.invoices, queryFn: () => api<Invoice[]>('/invoices') })
export const useOperatorVisits = () =>
  useQuery({ queryKey: keys.operatorVisits, queryFn: () => api<Visit[]>('/operator/visits?status=open') })
export const useAnomalies = () =>
  useQuery({ queryKey: keys.anomalies, queryFn: () => api<Anomaly[]>('/operator/anomalies') })
export const useGateEvents = () =>
  useQuery({ queryKey: keys.gateEvents, queryFn: () => api<GateEvent[]>('/operator/gate-events') })
