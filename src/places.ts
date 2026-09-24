// Countries for the weather setting when a city is not wanted (or the
// search is offline): the weather is taken at the capital. For a big
// country a city is better; the panel says so.
export interface Country {
  ru: string;
  en: string;
  capitalRu: string;
  capitalEn: string;
  lat: number;
  lon: number;
}
const c = (ru: string, en: string, capitalRu: string, capitalEn: string, lat: number, lon: number): Country => ({ ru, en, capitalRu, capitalEn, lat, lon });
export const countries: Country[] = [
  c("Россия", "Russia", "Москва", "Moscow", 55.756, 37.617),
  c("Украина", "Ukraine", "Киев", "Kyiv", 50.45, 30.524),
  c("Беларусь", "Belarus", "Минск", "Minsk", 53.9, 27.567),
  c("Казахстан", "Kazakhstan", "Астана", "Astana", 51.169, 71.449),
  c("Узбекистан", "Uzbekistan", "Ташкент", "Tashkent", 41.311, 69.28),
  c("Кыргызстан", "Kyrgyzstan", "Бишкек", "Bishkek", 42.874, 74.59),
  c("Таджикистан", "Tajikistan", "Душанбе", "Dushanbe", 38.56, 68.774),
  c("Туркменистан", "Turkmenistan", "Ашхабад", "Ashgabat", 37.96, 58.326),
  c("Азербайджан", "Azerbaijan", "Баку", "Baku", 40.409, 49.867),
  c("Армения", "Armenia", "Ереван", "Yerevan", 40.181, 44.514),
  c("Грузия", "Georgia", "Тбилиси", "Tbilisi", 41.716, 44.783),
  c("Молдова", "Moldova", "Кишинёв", "Chisinau", 47.011, 28.863),
  c("Латвия", "Latvia", "Рига", "Riga", 56.949, 24.106),
  c("Литва", "Lithuania", "Вильнюс", "Vilnius", 54.687, 25.28),
  c("Эстония", "Estonia", "Таллин", "Tallinn", 59.437, 24.754),
  c("Польша", "Poland", "Варшава", "Warsaw", 52.23, 21.012),
  c("Германия", "Germany", "Берлин", "Berlin", 52.52, 13.405),
  c("Франция", "France", "Париж", "Paris", 48.857, 2.352),
  c("Великобритания", "United Kingdom", "Лондон", "London", 51.507, -0.128),
  c("Ирландия", "Ireland", "Дублин", "Dublin", 53.35, -6.26),
  c("Испания", "Spain", "Мадрид", "Madrid", 40.417, -3.704),
  c("Португалия", "Portugal", "Лиссабон", "Lisbon", 38.722, -9.139),
  c("Италия", "Italy", "Рим", "Rome", 41.903, 12.496),
  c("Нидерланды", "Netherlands", "Амстердам", "Amsterdam", 52.368, 4.904),
  c("Бельгия", "Belgium", "Брюссель", "Brussels", 50.85, 4.352),
  c("Швейцария", "Switzerland", "Берн", "Bern", 46.948, 7.447),
  c("Австрия", "Austria", "Вена", "Vienna", 48.208, 16.374),
  c("Чехия", "Czechia", "Прага", "Prague", 50.075, 14.438),
  c("Словакия", "Slovakia", "Братислава", "Bratislava", 48.149, 17.107),
  c("Венгрия", "Hungary", "Будапешт", "Budapest", 47.498, 19.04),
  c("Румыния", "Romania", "Бухарест", "Bucharest", 44.426, 26.103),
  c("Болгария", "Bulgaria", "София", "Sofia", 42.698, 23.322),
  c("Сербия", "Serbia", "Белград", "Belgrade", 44.787, 20.457),
  c("Греция", "Greece", "Афины", "Athens", 37.984, 23.728),
  c("Турция", "Turkey", "Анкара", "Ankara", 39.934, 32.86),
  c("Финляндия", "Finland", "Хельсинки", "Helsinki", 60.17, 24.938),
  c("Швеция", "Sweden", "Стокгольм", "Stockholm", 59.329, 18.069),
  c("Норвегия", "Norway", "Осло", "Oslo", 59.914, 10.752),
  c("Дания", "Denmark", "Копенгаген", "Copenhagen", 55.676, 12.568),
  c("США", "United States", "Вашингтон", "Washington", 38.907, -77.037),
  c("Канада", "Canada", "Оттава", "Ottawa", 45.421, -75.697),
  c("Мексика", "Mexico", "Мехико", "Mexico City", 19.433, -99.133),
  c("Бразилия", "Brazil", "Бразилиа", "Brasília", -15.794, -47.882),
  c("Аргентина", "Argentina", "Буэнос-Айрес", "Buenos Aires", -34.604, -58.382),
  c("Япония", "Japan", "Токио", "Tokyo", 35.676, 139.65),
  c("Южная Корея", "South Korea", "Сеул", "Seoul", 37.567, 126.978),
  c("Китай", "China", "Пекин", "Beijing", 39.904, 116.407),
  c("Монголия", "Mongolia", "Улан-Батор", "Ulaanbaatar", 47.886, 106.906),
  c("Индия", "India", "Нью-Дели", "New Delhi", 28.614, 77.209),
  c("Таиланд", "Thailand", "Бангкок", "Bangkok", 13.756, 100.502),
  c("Вьетнам", "Vietnam", "Ханой", "Hanoi", 21.028, 105.854),
  c("Индонезия", "Indonesia", "Джакарта", "Jakarta", -6.209, 106.846),
  c("ОАЭ", "United Arab Emirates", "Абу-Даби", "Abu Dhabi", 24.454, 54.377),
  c("Египет", "Egypt", "Каир", "Cairo", 30.044, 31.236),
  c("ЮАР", "South Africa", "Претория", "Pretoria", -25.747, 28.188),
  c("Австралия", "Australia", "Канберра", "Canberra", -35.281, 149.13),
  c("Новая Зеландия", "New Zealand", "Веллингтон", "Wellington", -41.286, 174.776),
];
/** Countries whose name (either language) starts with the query. */
export function findCountries(query: string): Country[] {
  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  if (q.length < 2) return [];
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
  return countries.filter((x) => norm(x.ru).startsWith(q) || norm(x.en).startsWith(q));
}
