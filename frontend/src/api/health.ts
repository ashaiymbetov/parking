import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export interface HealthReport {
  status: 'ok' | 'error'
  db: 'up' | 'down'
  time: string
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthReport>('/health'),
    refetchInterval: 5000,
    retry: false,
  })
}
