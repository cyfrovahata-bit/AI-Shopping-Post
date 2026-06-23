export type ShafaCondition =
  | "Новий"
  | "Ідеальний"
  | "Дуже хороший"
  | "Хороший"
  | "Задовільний";

export type ShafaSizeSystem =
  | "Міжнародний"
  | "Європейський"
  | "🇺🇦 Український";

export type ShafaProduct = {
  title: string;
  description: string;
  price: string;
  condition: ShafaCondition;
  keywords: string[];
  imagePaths: string[];
  categoryPath: string[];
  quantity?: string;
  brand?: string;
  sizeSystem?: ShafaSizeSystem;
  sizes?: string[];         // один або кілька розмірів
  colors?: string[];        // до 2 кольорів із SHAFA_COLORS
  materials?: string[];     // один або кілька матеріалів
  sleeveLength?: string;    // "Без рукавів" | "Довгий" | "Короткий" | "Три чверті"
  sleeveStyle?: string[];   // "Рукави буфи" | "Рукави ліхтарики" | "Широкі рукави"
  seasons?: string[];       // "Весна" | "Демісезон" | "Зима" | "Літо" | "Осінь"
  features?: string[];      // "Великі розміри" | "Коктейльні" | "На випускний" | "Пишні"
  silhouette?: string[];      // текстове поле "Силует": "З відкритими плечима" | "А-силует" | ...
  fashionCut?: string[];      // текстове поле "Фасон": "На бретелях" | "Сарафан" | ...
  print?: string[];           // текстове поле "Принт": тільки якщо є принт (не однотонна)
  style?: string[];           // текстове поле "Стиль": "Вечірній" | "Повсякденний" | ...
  decor?: string;             // текстове поле "Декор": "Без декору" | "Волани" | ...
  modelFeatures?: string[];   // текстове поле "Особливості моделі": "V-подібний виріз" | ...
  madeInUkraine?: "Виробництво" | "Хендмейд";
};

export const SHAFA_COLORS = [
  "Білий", "Сріблястий", "Бежевий", "Сірий", "Жовтий", "Золотистий",
  "Помаранчевий", "Рожевий", "Червоний", "Бірюзовий", "Синій", "Хакі",
  "Зелений", "Фіолетовий", "Коричневий", "Чорний", "Різнокольоровий",
  "Блакитний", "Бордовий", "Салатовий", "Персиковий", "Бузковий",
  "Кораловий", "Гірчичний", "Фуксія", "М'ятний", "Малиновий",
  "Молочний", "Графітовий", "Оливковий", "Нюдовий", "Прозорий",
] as const;

export const SHAFA_SIZES_INT = [
  "XХS", "ХS", "S", "M", "L", "XL", "XXL", "XXXL",
  "4XL", "5XL", "6XL", "7XL", "8XL", "9XL",
  "XXS-XS", "XS-S", "S-M", "M-L", "L-XL", "XL-XXL",
  "One size", "Інший",
] as const;

export const SHAFA_SLEEVE_LENGTHS = ["Без рукавів", "Довгий", "Короткий", "Три чверті"] as const;
export const SHAFA_SLEEVE_STYLES = ["Рукави буфи", "Рукави ліхтарики", "Широкі рукави"] as const;
export const SHAFA_SEASONS = ["Весна", "Демісезон", "Зима", "Літо", "Осінь"] as const;
export const SHAFA_FEATURES = ["Великі розміри", "Коктейльні", "На випускний", "Пишні"] as const;
