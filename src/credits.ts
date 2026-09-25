// Who made what: shown under every character in the pickers and on the
// "About" page, the same facts as THIRD_PARTY.md. Russian text is the key
// for tx(); URLs open in the browser (open_link).
export interface Credit {
  /** Pet id, or a short key for everything else. */
  id: string;
  title: string;
  /** Author, or "" when the source does not name one. */
  author: string;
  url: string;
  /** License or terms, Russian (translated through tx). */
  terms: string;
}
export const petCredits: Credit[] = [
  {
    id: "drizz",
    title: "Drizz",
    author: "",
    url: "https://codex-pet.com/pets/drizz",
    terms: "галерея codex-pet.com, автор не указан, лицензии нет: личное некоммерческое использование с указанием источника",
  },
  {
    id: "claude",
    title: "Claude",
    author: "XiangWang",
    url: "https://github.com/xiangking/Claude-style-Codex-pet",
    terms: "лицензия MIT",
  },
  {
    id: "eigenblob",
    title: "Eigenblob",
    author: "",
    url: "https://codex-pet.com/pets/eigenblob",
    terms: "галерея codex-pet.com, автор не указан, лицензии нет: личное некоммерческое использование с указанием источника",
  },
  {
    id: "aqua-wisp",
    title: "Aqua Wisp",
    author: "",
    url: "https://codex-pet.com/pets/aqua-wisp",
    terms: "галерея codex-pet.com, автор не указан, лицензии нет: личное некоммерческое использование с указанием источника",
  },
  {
    id: "nezukocoder",
    title: "Nezuko Coder",
    author: "Miro H.",
    url: "https://petdex.dev/pets/nezukocoder",
    terms: "галерея petdex.dev, лицензии нет: личное некоммерческое использование с указанием источника; фан-арт по «Клинку, рассекающему демонов»",
  },
];
export const otherCredits: Credit[] = [
  { id: "windowpet", title: "WindowPet", author: "Seakmeng", url: "https://github.com/SeakMengs/WindowPet", terms: "основа приложения, лицензия MIT" },
  {
    id: "vpet",
    title: "VPet",
    author: "LorisYounger",
    url: "https://github.com/LorisYounger/VPet",
    terms: "иконки еды и формулы роста; код Apache-2.0, графика - некоммерческое использование с указанием автора",
  },
  { id: "kenney", title: "Kenney - Interface Sounds, RPG Audio", author: "Kenney", url: "https://kenney.nl/assets", terms: "звуки, CC0" },
  { id: "nunito", title: "Nunito", author: "Vernon Adams, Cyreal, Jacques Le Bailly", url: "https://github.com/googlefonts/nunito", terms: "шрифт, SIL Open Font License 1.1" },
  { id: "tauri", title: "Tauri", author: "Tauri Programme", url: "https://tauri.app", terms: "MIT / Apache-2.0" },
  { id: "phaser", title: "Phaser", author: "Phaser Studio", url: "https://phaser.io", terms: "MIT" },
  { id: "radix", title: "Radix Themes", author: "WorkOS", url: "https://github.com/radix-ui/themes", terms: "интерфейс настроек, MIT" },
  { id: "lucide", title: "Lucide", author: "Lucide contributors", url: "https://lucide.dev", terms: "иконки, ISC" },
  { id: "spinners", title: "cli-spinners", author: "Sindre Sorhus", url: "https://github.com/sindresorhus/cli-spinners", terms: "анимация статуса работы, MIT" },
  { id: "meteo", title: "Open-Meteo", author: "", url: "https://open-meteo.com", terms: "погода и поиск городов (GeoNames), CC BY 4.0" },
  {
    id: "who",
    title: "WHO / ITU-T H.870",
    author: "",
    url: "https://www.itu.int/rec/T-REC-H.870",
    terms: "нормы безопасного прослушивания для «Береги уши»",
  },
];
export const petCredit = (id: string) => petCredits.find((c) => c.id === id);
