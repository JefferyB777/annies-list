export type Budget = {
  id: string;
  name: string;
  total: number;
  created_at: string;
};

export type Item = {
  id: string;
  budget_id: string;
  /** barcode, or "name:<normalized name>" for items typed in without a barcode */
  product_key: string;
  barcode: string | null;
  name: string;
  store: string;
  /** price for ONE unit */
  price: number;
  qty: number;
  created_at: string;
};

export type NewItem = Omit<Item, "id" | "created_at">;

export type PriceStats = {
  count: number;
  avg: number;
  last: number;
  lastStore: string;
  low: number;
  lowStore: string;
  name: string;
};
