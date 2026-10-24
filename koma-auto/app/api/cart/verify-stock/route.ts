import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';

export const dynamic = 'force-dynamic';

interface CartItemCheck {
  id: string;
  name: string;
  quantity: number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: CartItemCheck[] = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ valid: true });
    }

    const sql = client;
    if (!isDbConfigured() || !sql) {
      return NextResponse.json({ valid: true });
    }

    const ids = items.map((i) => i.id);
    const rows = await sql`
      SELECT id, title, stock_quantity, in_stock
      FROM my_sklad_products
      WHERE id = ANY(${ids});
    `;

    const rowMap = new Map<string, { stock_quantity: number; in_stock: boolean; title: string }>();
    rows.forEach((r: any) => {
      rowMap.set(r.id, {
        stock_quantity: Math.max(0, Number(r.stock_quantity) || 0),
        in_stock: Boolean(r.in_stock),
        title: r.title,
      });
    });

    const errors: Array<{
      id: string;
      name: string;
      requestedQuantity: number;
      availableStock: number;
      message: string;
    }> = [];

    for (const item of items) {
      const dbItem = rowMap.get(item.id);
      if (!dbItem) continue;

      const availableStock = dbItem.stock_quantity;
      const isAvailable = dbItem.in_stock && availableStock > 0;
      const itemName = item.name || dbItem.title;

      if (!isAvailable) {
        errors.push({
          id: item.id,
          name: itemName,
          requestedQuantity: item.quantity,
          availableStock: 0,
          message: `Товар "${itemName}" закончился на складе`,
        });
      } else if (item.quantity > availableStock) {
        errors.push({
          id: item.id,
          name: itemName,
          requestedQuantity: item.quantity,
          availableStock,
          message: `Товар "${itemName}" доступен в количестве ${availableStock} шт. (в корзине: ${item.quantity} шт.)`,
        });
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ valid: false, errors }, { status: 409 });
    }

    return NextResponse.json({ valid: true });
  } catch (error: any) {
    console.error('Error verifying stock:', error);
    return NextResponse.json({ valid: true });
  }
}
