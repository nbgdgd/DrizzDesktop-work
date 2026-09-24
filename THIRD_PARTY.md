# Источники

Основа: WindowPet, Copyright (c) 2023 Seakmeng, MIT.
Исходный предоставленный архив без изменений распакован в `upstream/WindowPet-main`.
Сохранены стек Tauri / React / Phaser, жизненный цикл прозрачного canvas и принцип отдельного окна настроек с треем. Одноэкранная физика и исходные персонажи заменены для требований этого проекта. Автообновление из чужого репозитория отключено. Лицензия каркаса также включена в `public/WINDOWPET-LICENSE.txt`.

Спрайты, раскладка кадров и часть реплик перенесены из локального AniBlaze, без изменения донора:

- Drizz — https://codex-pet.com/pets/drizz
- Claude — XiangWang, https://github.com/xiangking/Claude-style-Codex-pet, MIT; LICENSE рядом со спрайтом.
- Eigenblob — https://codex-pet.com/pets/eigenblob
- Aqua Wisp — https://codex-pet.com/pets/aqua-wisp
- Nezuko Coder — Miro H., https://petdex.dev/pets/nezukocoder

Оригинальные `pet.json` с указанием источников и сведениями о лицензиях сохранены в `public/pets/<id>/`. MIT исходного каркаса не распространяется автоматически на стороннюю графику.

Значок нового приложения — собственный простой SVG `public/mark.svg`, а не персонаж из WindowPet.

## Магазин

Иконки еды, напитков и лекарств в `public/shop/` взяты из VPet — LorisYounger, https://github.com/LorisYounger/VPet (код Apache-2.0; графика по условиям автора: некоммерческое использование с указанием источника и ссылки на репозиторий). Формулы уровня, настроения и еды перенесены из `VPet-Simulator.Core/Handle/GameSave.cs` и `Display/MainLogic.cs`, значения предметов — из `mod/0000_core/food/food.lps` и `drug.lps`. Файлы переименованы в латиницу, содержимое не менялось.

## Звуки

Короткие эффекты в `public/sfx/` — паки Kenney (CC0, общественное достояние):

- Interface Sounds — https://kenney.nl/assets/interface-sounds (click, poke, talk, drink, levelup, upgrade, error, work, summon, drop, sleep, wake)
- RPG Audio — https://kenney.nl/assets/rpg-audio (eat — `chop`, coin — `handleCoins`)

Оригинальный текст лицензии — `public/sfx/Kenney-License.txt`. CC0 не требует указания авторства; ссылки оставлены из вежливости.

## Интерфейс настроек

- Radix Themes — WorkOS, https://github.com/radix-ui/themes, MIT.
- Lucide — https://github.com/lucide-icons/lucide, ISC.

Подключаются как npm-зависимости и собираются в отдельный бандл окна настроек.

## Окно питомца

- cli-spinners — Sindre Sorhus, https://github.com/sindresorhus/cli-spinners, MIT. Кадры спиннеров в панели статуса работы (`workhud.ts`).

## Погода

Данные о погоде — Open-Meteo, https://open-meteo.com, CC BY 4.0. Поиск города — геокодер Open-Meteo на данных GeoNames (CC BY 4.0): уходит только набранное название и только по кнопке «Найти». Погода запрашивается только при включённой настройке «Показывать погоду» и только для выбранного места. Список стран со столицами (`src/places.ts`) — собственный.

## Шрифт

Nunito — Vernon Adams, Cyreal, Jacques Le Bailly, https://github.com/googlefonts/nunito, SIL Open Font License 1.1 (пакет `@fontsource/nunito`).

## Нормы «Береги уши»

ВОЗ и МСЭ, ITU-T H.870 «Guidelines for safe listening devices/systems» — только числа нормы (80 дБА × 40 ч, 75 дБА в бережном режиме), без текста стандарта.

## Звуки действий и бормотание

Синтезируются в `src/voice.ts` через WebAudio, записанных файлов нет.

## В программе

Тот же список — на странице «О программе» и строкой под каждым персонажем в выборе персонажа (`src/credits.ts`). Персонажи без лицензии (Drizz, Eigenblob, Aqua Wisp, Nezuko Coder) и графика VPet разрешены только для некоммерческого использования с указанием источника: сборку нельзя продавать. Перед широкой публикацией — см. `docs/RELEASE.md`.
