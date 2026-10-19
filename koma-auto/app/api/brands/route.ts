import { NextResponse } from 'next/server';
import { CANONICAL_BRANDS } from '@/lib/manager-brands';

export const revalidate = 86400;

export async function GET() {
  try {
    return NextResponse.json(CANONICAL_BRANDS);
  } catch (error) {
    console.error('Error serving brands:', error);
    return NextResponse.json({ error: 'Failed to fetch brands' }, { status: 500 });
  }
}
