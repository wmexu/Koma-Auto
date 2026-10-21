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
