import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Conditional Tailwind class joiner — twMerge resolves conflicts so callers can override defaults.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
