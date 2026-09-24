// Small building blocks shared by the panel pages, on top of Radix Themes.
import { ReactNode } from "react";
import { Badge, Box, Card, Flex, Heading, Progress, Switch, Text } from "@radix-ui/themes";
import type { ThemeProps } from "@radix-ui/themes";
/** Radix accent colour per pet. */
export const accents: Record<string, NonNullable<ThemeProps["accentColor"]>> = {
  drizz: "lime",
  claude: "orange",
  eigenblob: "violet",
  "aqua-wisp": "cyan",
  nezukocoder: "crimson",
};
/** First frame of the pet's atlas, scaled to `size` px wide. */
export function Portrait({ pet, size = 64, cell = 0 }: { pet: string; size?: number; cell?: number }) {
  const s = size / 192;
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: Math.round(208 * s),
        backgroundImage: `url('/pets/${pet}/spritesheet.webp')`,
        backgroundSize: `${1536 * s}px ${1872 * s}px`,
        backgroundPosition: `${-(cell % 8) * 192 * s}px ${-Math.floor(cell / 8) * 208 * s}px`,
        imageRendering: "auto",
        flexShrink: 0,
      }}
    />
  );
}
export function Section({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card size="2" mb="4">
      <Flex justify="between" align="start" gap="3" mb={description ? "1" : "3"}>
        <Heading as="h2" size="3" weight="medium">
          {title}
        </Heading>
        {action}
      </Flex>
      {description && (
        <Text as="p" size="2" color="gray" mb="3">
          {description}
        </Text>
      )}
      <Flex direction="column" gap="3">
        {children}
      </Flex>
    </Card>
  );
}
export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Flex justify="between" align="center" gap="4">
      <Box minWidth="0">
        <Text as="div" size="2" weight="medium">
          {label}
        </Text>
        {hint && (
          <Text as="div" size="1" color="gray" mt="1">
            {hint}
          </Text>
        )}
      </Box>
      <Box flexShrink="0">{children}</Box>
    </Flex>
  );
}
export function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} hint={hint}>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}
export function Meter({ label, value, max = 100, text, color }: { label: string; value: number; max?: number; text?: string; color?: "red" | "amber" | "green" | "gray" }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const tone = color ?? (pct < 25 ? "red" : pct < 45 ? "amber" : undefined);
  return (
    <Box>
      <Flex justify="between" mb="1">
        <Text size="2">{label}</Text>
        <Text size="1" color="gray">
          {text ?? `${Math.round(value)} / ${max}`}
        </Text>
      </Flex>
      <Progress value={pct} color={tone} size="2" aria-label={label} />
    </Box>
  );
}
export const money = (v: number) => `${Math.floor(v).toLocaleString("ru")} ₽`;
export function Money({ value }: { value: number }) {
  return (
    <Badge size="2" variant="soft" color="amber">
      {money(value)}
    </Badge>
  );
}
