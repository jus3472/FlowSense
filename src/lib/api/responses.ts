import { NextResponse } from 'next/server'

/** Every API failure answers with a sentence the record screen can show as is. */
export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}
