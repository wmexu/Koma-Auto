import { 
  pgTable, 
  serial, 
  text, 
  integer, 
  varchar, 
  index, 
  numeric, 
  boolean, 
  jsonb, 
  timestamp 
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// 1. Таблица нашего наличия (Высокоскоростное зеркало МоегоСклада с обогащением)
export const mySkladProducts = pgTable("my_sklad_products", {
  id: varchar("id", { length: 255 }).primaryKey(), // ID из МоегоСклада (UUID)
  title: text("title").notNull(),
  price: numeric("price").notNull(),
  oldPrice: numeric("old_price"),
  stockQuantity: integer("stock_quantity").notNull().default(0), // Остаток на складе Car City
  inStock: boolean("in_stock").notNull().default(false),
  brand: varchar("brand", { length: 100 }), // Нормализованный канонический бренд
  category: varchar("category", { length: 100 }), // Категория (двигатель, подвеска и т.д.)
  originalOem: varchar("original_oem", { length: 255 }), // Исходный код/артикул из МС
  cleanOemNumber: varchar("clean_oem_number", { length: 255 }).notNull(), // Чистый OEM без дефисов и суффиксов
  image: text("image"), // Главное фото (CDN / WebP)
  images: jsonb("images").$type<string[]>().default([]), // Массив всех фото
  specs: jsonb("specs").$type<Record<string, string>>().default({}), // Характеристики
  compatibility: jsonb("compatibility").$type<Array<{
    make: string;
    model: string;
    generation?: string;
    years?: string;
    engines?: string[];
    position?: string;
  }>>().default([]), // Совместимость с авто (Марка, модель, годы, двигатели)
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  cleanOemIdx: index("idx_ms_clean_oem").on(table.cleanOemNumber),
  brandIdx: index("idx_ms_brand").on(table.brand),
  categoryIdx: index("idx_ms_category").on(table.category),
  inStockIdx: index("idx_ms_in_stock").on(table.inStock),
}));

// 2. Модификации автомобилей (K-Type / Vehicle_ID)
export const tecdocVehicles = pgTable("tecdoc_vehicles", {
  id: integer("id").primaryKey(), // Внутренний ID TecDoc (K-Type)
  make: varchar("make", { length: 100 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  generation: varchar("generation", { length: 100 }),
  yearStart: integer("year_start"),
  yearEnd: integer("year_end"),
  engineDetails: text("engine_details"),
}, (table) => ({
  makeModelIdx: index("idx_vehicle_make_model").on(table.make, table.model),
}));

// 3. Маски VIN кодов (WMI + VDS)
export const tecdocVinMasks = pgTable("tecdoc_vin_masks", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => tecdocVehicles.id),
  mask: varchar("mask", { length: 20 }).notNull(), // Например: WBAVA110
}, (table) => ({
  maskIdx: index("idx_vin_mask").on(table.mask),
}));

// 4. Справочник артикулов TecDoc
export const tecdocArticles = pgTable("tecdoc_articles", {
  id: integer("id").primaryKey(),
  brand: varchar("brand", { length: 100 }),
  oemNumber: varchar("oem_number", { length: 255 }).notNull(),
  cleanOemNumber: varchar("clean_oem_number", { length: 255 }).notNull(), // Для JOIN'а с нашей таблицей my_sklad
}, (table) => ({
  cleanOemIdx: index("idx_td_clean_oem").on(table.cleanOemNumber),
}));

// 5. Кросс-таблица: Применяемость деталей к автомобилям
export const tecdocCrossReferences = pgTable("tecdoc_cross_references", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => tecdocVehicles.id),
  articleId: integer("article_id").notNull().references(() => tecdocArticles.id),
}, (table) => ({
  vehicleArticleIdx: index("idx_vehicle_article").on(table.vehicleId, table.articleId),
}));

// --- Настройка связей (Relations) для Drizzle ---
export const mySkladProductsRelations = relations(mySkladProducts, () => ({}));

export const tecdocVehiclesRelations = relations(tecdocVehicles, ({ many }) => ({
  masks: many(tecdocVinMasks),
  crossReferences: many(tecdocCrossReferences),
}));

export const tecdocArticlesRelations = relations(tecdocArticles, ({ many }) => ({
  crossReferences: many(tecdocCrossReferences),
}));


// 6. Пользователи и роли (RBAC)
export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  fullName: varchar("full_name", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  role: varchar("role", { length: 50 }).notNull().default("customer"),
  isBlocked: boolean("is_blocked").notNull().default(false),
  failedCodeAttempts: integer("failed_code_attempts").notNull().default(0),
  blockedUntil: timestamp("blocked_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  roleIdx: index("idx_users_role").on(table.role),
  emailIdx: index("idx_users_email").on(table.email),
}));

// 7. Заказы (Orders в Neon)
export const orders = pgTable("orders", {
  id: varchar("id", { length: 255 }).primaryKey(),
  invoiceId: varchar("invoice_id", { length: 255 }),
  userId: varchar("user_id", { length: 255 }).references(() => users.id),
  amount: numeric("amount").notNull(),
  itemsPrice: numeric("items_price").notNull(),
  deliveryCost: numeric("delivery_cost").notNull().default("0"),
  deliveryMethod: varchar("delivery_method", { length: 50 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull(),
  paymentStatus: varchar("payment_status", { length: 50 }).notNull().default("pending"),
  fulfillmentStatus: varchar("fulfillment_status", { length: 50 }).notNull().default("assembling"),
  pickupCodeHash: varchar("pickup_code_hash", { length: 64 }),
  pickupCodeSalt: varchar("pickup_code_salt", { length: 32 }),
  assignedCourierId: varchar("assigned_courier_id", { length: 255 }).references(() => users.id),
  customerName: varchar("customer_name", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 50 }),
  customerEmail: varchar("customer_email", { length: 255 }),
  kaspiPhone: varchar("kaspi_phone", { length: 50 }),
  deliveryAddress: text("delivery_address"),
  city: varchar("city", { length: 100 }),
  items: jsonb("items").$type<any[]>().default([]),
  warehouseId: varchar("warehouse_id", { length: 100 }).default("car_city_podval"),
  completedAt: timestamp("completed_at"),
  completedByUserId: varchar("completed_by_user_id", { length: 255 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  fulfillmentIdx: index("idx_orders_fulfillment_status").on(table.fulfillmentStatus),
  courierIdx: index("idx_orders_assigned_courier").on(table.assignedCourierId),
}));

// 8. Одноразовые токены активации ролей (24-значные)
export const roleActivationTokens = pgTable("role_activation_tokens", {
  id: varchar("id", { length: 255 }).primaryKey(),
  token: varchar("token", { length: 24 }).unique().notNull(),
  role: varchar("role", { length: 50 }).notNull(),
  createdBy: varchar("created_by", { length: 255 }).references(() => users.id),
  boundEmail: varchar("bound_email", { length: 255 }),
  usedBy: varchar("used_by", { length: 255 }).references(() => users.id),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  tokenIdx: index("idx_role_tokens_token").on(table.token),
}));

// 9. Промокоды
export const promocodes = pgTable("promocodes", {
  id: varchar("id", { length: 255 }).primaryKey(),
  code: varchar("code", { length: 50 }).unique().notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  value: numeric("value").notNull(),
  minCartTotal: numeric("min_cart_total").notNull().default("0"),
  maxDiscount: numeric("max_discount"),
  targetAudience: varchar("target_audience", { length: 20 }).notNull().default("all"),
  boundUserId: varchar("bound_user_id", { length: 255 }).references(() => users.id),
  usageLimit: integer("usage_limit"),
  usedCount: integer("used_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by", { length: 255 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  codeIdx: index("idx_promocodes_code").on(table.code),
}));

// 10. Системные настройки (Kill-switch, активный склад)
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: varchar("updated_by", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 11. Журнал безопасности (Audit Logs)
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  createdIdx: index("idx_audit_created_at").on(table.createdAt),
}));
