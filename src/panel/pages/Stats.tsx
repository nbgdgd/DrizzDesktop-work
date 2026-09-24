import { useEffect, useState } from "react";
import { Box, Button, Flex, SegmentedControl, Table, Text } from "@radix-ui/themes";
import { command } from "../../bridge";
import { appName, formatDuration } from "../../apps";
import type { PanelState } from "../store";
interface UsageStats {
  today: { app: string; seconds: number }[];
  week: { app: string; seconds: number }[];
  month: { app: string; seconds: number }[];
  all: { app: string; seconds: number }[];
}
const periods = [
  ["today", "Сегодня"],
  ["week", "7 дней"],
  ["month", "30 дней"],
  ["all", "Всё время"],
] as const;
export function Stats({ p }: { p: PanelState }) {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [period, setPeriod] = useState<(typeof periods)[number][0]>("today");
  useEffect(() => {
    let gone = false;
    const load = () =>
      void command<UsageStats>("usage_stats")
        .then((u) => !gone && setUsage(u))
        .catch((e) => p.setError(String(e)));
    load();
    const t = setInterval(load, 30000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, []);
  const rows = usage?.[period] ?? [];
  const total = rows.reduce((a, r) => a + r.seconds, 0);
  const opinion = p.store.game.life.apps;
  return (
    <>
      <Flex justify="between" align="center" mb="3" gap="3" wrap="wrap">
        <SegmentedControl.Root value={period} onValueChange={(v) => setPeriod(v as typeof period)} size="1">
          {periods.map(([id, name]) => (
            <SegmentedControl.Item key={id} value={id}>
              {name}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
        {rows.length > 0 && <Text size="2" color="gray">Всего: {formatDuration(total)}</Text>}
      </Flex>
      {rows.length === 0 ? (
        <Text as="p" color="gray" size="2">
          {usage ? "Пока пусто. Время считается, пока вы за компьютером." : "Загрузка…"}
        </Text>
      ) : (
        <Table.Root size="1" variant="surface" mb="4">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Программа</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell width="40%" />
              <Table.ColumnHeaderCell justify="end">Время</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Питомец о ней</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.slice(0, 40).map((r) => {
              const o = opinion[r.app.toLowerCase()] ?? 0;
              return (
                <Table.Row key={r.app}>
                  <Table.RowHeaderCell title={r.app}>{appName(r.app)}</Table.RowHeaderCell>
                  <Table.Cell>
                    <Box className="usage-bar" style={{ width: `${(r.seconds / Math.max(1, rows[0].seconds)) * 100}%` }} />
                  </Table.Cell>
                  <Table.Cell justify="end">{formatDuration(r.seconds)}</Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="1" color={o <= -25 ? "red" : o >= 40 ? "green" : "gray"}>
                      {o <= -25 ? "не любит" : o >= 40 ? "любит" : "—"}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}
      <Button
        color="red"
        variant="soft"
        onClick={() => p.run(command("usage_clear").then(() => setUsage({ today: [], week: [], month: [], all: [] })), "Статистика очищена")}
      >
        Очистить статистику
      </Button>
    </>
  );
}
