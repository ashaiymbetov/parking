export type Role = 'driver' | 'operator'
export interface User { id: string; email: string; role: Role }
export interface Car { id: string; plate: string }
export interface Me extends User { cars: Car[] }
export type SpotState = 'free' | 'booked' | 'occupied'
export interface Spot { id: string; code: string; row: number; col: number; state: SpotState; version: number }
export interface Booking {
  id: string
  status: string
  spot: { id: string; code: string }
  car: { id: string; plate: string }
  from: string
  to: string
  createdAt: string
}
export interface Segment {
  kind: 'day' | 'night'
  from: string
  to: string
  minutes: number
  pricePerMinuteKop: number
  amountKop: number
}
export interface Invoice {
  id: string
  visitId: string
  plate: string
  minutes: number
  amountKop: number
  segments: Segment[]
  createdAt: string
}
export interface Visit {
  id: string
  plate: string
  spot: { id: string; code: string }
  bookingId: string | null
  enteredAt: string
  exitedAt: string | null
  closeReason: string | null
  invoice: Invoice | null
}
export interface Anomaly { id: string; kind: string; plate: string | null; details: Record<string, unknown>; createdAt: string }
export interface GateEvent {
  id: string
  kind: 'entry' | 'exit'
  rawPlate: string
  plate: string | null
  occurredAt: string
  outcome: 'ok' | 'rejected'
  errorCode: string | null
}
