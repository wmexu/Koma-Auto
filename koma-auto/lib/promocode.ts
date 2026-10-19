export interface TestPromoConfig {
  isTest: boolean;
  targetPrice: number;
  title: string;
}

export function getTestPromoConfig(code?: string | null): TestPromoConfig | null {
  if (!code || typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (!trimmed) return null;

  // 10 KZT Promo Codes (current primary test code)
  const code10 = (process.env.TEST_ORDER_PROMO_CODE || process.env.TEST_ORDER_PROMO_CODE_10 || '').trim();
  // 50 KZT Promo Code
  const code50 = (process.env.TEST_ORDER_PROMO_CODE_50 || '').trim();
  // 100 KZT Promo Code
  const code100 = (process.env.TEST_ORDER_PROMO_CODE_100 || '').trim();

  if (code10 && trimmed === code10) {
    return {
      isTest: true,
      targetPrice: 10,
      title: 'Служебный тестовый режим (10 ₸)',
    };
  }

  if (code50 && trimmed === code50) {
    return {
      isTest: true,
      targetPrice: 50,
      title: 'Служебный тестовый режим (50 ₸)',
    };
  }

  if (code100 && trimmed === code100) {
    return {
      isTest: true,
      targetPrice: 100,
      title: 'Служебный тестовый режим (100 ₸)',
    };
  }

  return null;
}

export function getTestPromoDisclaimer(price: number): string {
  return `ВНИМАНИЕ: АКТИВИРОВАН РЕЖИМ ТЕХНИЧЕСКОГО ТЕСТИРОВАНИЯ. Сумма заказа снижена до ${price} ₸ для верификации соединения с процессингом Halyk ePay. Данный заказ носит исключительно демонстрационно-технический характер, не является публичной офертой и не создает обязательств по передаче товаров (ст. 447, 449 ГК РК).`;
}
