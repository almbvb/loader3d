import type { Subscription, TierId } from '@/api/types';

/**
 * TIERS_ENABLED in .env. Off (the default): the site and the app say nothing about tariffs and nothing is
 * limited; the API agrees (it reads the same variable and sends `subscription: null`).
 */
export const TIERS_ENABLED: boolean = __TIERS_ENABLED__;

/**
 * Tiers as the landing page, the registration and the account page show them. The limits the API
 * enforces live in backend/app/tiers.py — `limits` here repeats them for the pricing table, keep the
 * two in sync. Prices are in roubles per month; there is no online payment yet (an admin activates
 * paid tiers), so they only inform.
 */
export interface TierInfo {
  id: TierId;
  name: string;
  /** Who it is for, one line. */
  tagline: string;
  /** ₽ per month, billed monthly / yearly; null — by contract. */
  price: { monthly: number; yearly: number } | null;
  limits: { plans: number | null; vehicles: number; items: number };
  features: string[];
  cta: string;
  highlighted?: boolean;
}

export const TRIAL_DAYS = 14;

export const TIERS: readonly TierInfo[] = [
  {
    id: 'free',
    name: 'Старт',
    tagline: 'Попробовать планировщик и считать редкие рейсы',
    price: { monthly: 0, yearly: 0 },
    limits: { plans: 3, vehicles: 1, items: 100 },
    features: [
      '3 сохранённые схемы',
      '1 машина в схеме, до 100 грузов',
      'Раскладка мышью и пальцем: гравитация, магниты, кантование',
      'LDM, заполнение, вес и центр тяжести',
      'PDF-план загрузки для водителя и склада',
    ],
    cta: 'Начать бесплатно',
  },
  {
    id: 'pro',
    name: 'Профи',
    tagline: 'Для логистов и складов, которые грузят каждый день',
    price: { monthly: 1990, yearly: 1590 },
    limits: { plans: null, vehicles: 10, items: 5000 },
    features: [
      'Безлимит схем',
      'До 10 машин и сцепок в одной схеме',
      'До 5000 грузов в схеме',
      'Автозагрузка с развесовкой и контролем грузоподъёмности',
      'Пошаговая PDF-инструкция погрузки',
      'Всё из тарифа «Старт»',
    ],
    cta: `${TRIAL_DAYS} дней бесплатно`,
    highlighted: true,
  },
  {
    id: 'custom',
    name: 'Индивидуальный',
    tagline: 'Для компаний и особых задач — условия по договору',
    price: null,
    limits: { plans: null, vehicles: 10, items: 5000 },
    features: [
      'Всё из тарифа «Профи»',
      'Лимиты, срок и стоимость — под ваши объёмы',
      'Работа по договору, оплата по счёту',
      'Помощь с внедрением: транспорт, типовые грузы, обучение',
      'Персональный контакт для вопросов',
    ],
    cta: 'Обсудить условия',
  },
];

export function tierInfo(id: TierId): TierInfo {
  return TIERS.find((t) => t.id === id) ?? TIERS[0];
}

export function formatPrice(rub: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(rub)} ₽`;
}

/** «Профи до 12 ноября», «Пробный период до…», «Без срока». */
export function subscriptionSummary(sub: Subscription): string {
  if (sub.tier === 'free') return sub.expiredTier ? `Тариф «${tierInfo(sub.expiredTier).name}» закончился` : 'Бесплатный тариф';
  if (!sub.expiresAt) return 'Без ограничения по сроку';
  const date = new Date(sub.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return sub.trial ? `Пробный период до ${date}` : `Действует до ${date}`;
}
