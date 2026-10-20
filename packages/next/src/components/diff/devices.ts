import { AppWindow, Laptop, Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";

export type DeviceId = "window" | "desktop" | "laptop" | "tablet" | "phone" | "custom";

export interface Device {
  id: DeviceId;
  label: string;
  sub: string;
  w: number;
  /** `fill` = take the height the stage gives it. */
  h: number | "fill";
  icon: LucideIcon;
  bezel: number;
  radius: number;
  kind: "screen" | "tablet" | "phone";
}

export const DEVICES: Device[] = [
  { id: "desktop", label: "Desktop", sub: "1440 wide", w: 1440, h: "fill", icon: Monitor, bezel: 0, radius: 12, kind: "screen" },
  { id: "laptop", label: "Laptop", sub: "1100 wide", w: 1100, h: "fill", icon: Laptop, bezel: 0, radius: 12, kind: "screen" },
  { id: "tablet", label: "iPad", sub: "820 × 1180", w: 820, h: 1180, icon: Tablet, bezel: 14, radius: 30, kind: "tablet" },
  { id: "phone", label: "iPhone", sub: "393 × 852", w: 393, h: 852, icon: Smartphone, bezel: 11, radius: 50, kind: "phone" },
];

export const CUSTOM_DEVICE: Device = {
  id: "custom",
  label: "Custom",
  sub: "any width",
  w: 1024,
  h: "fill",
  icon: Monitor,
  bezel: 0,
  radius: 12,
  kind: "screen",
};

// Same width and height as the developer's window, so 100vh and media queries do not reflow as the page shrinks in.
export function windowDevice(w: number, h: number): Device {
  return { id: "window", label: "This window", sub: `${w} × ${h}`, w, h, icon: AppWindow, bezel: 0, radius: 12, kind: "screen" };
}

export type ViewMode = "side" | "slider" | "fade" | "difference";

export const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: "side", label: "Side by side", hint: "Synced, aligned scrolling" },
  { id: "slider", label: "Slider", hint: "Drag to reveal B over A" },
  { id: "fade", label: "Fade", hint: "Cross-fade between A and B" },
  { id: "difference", label: "Difference", hint: "Pixels that differ light up" },
];

export type SyncMode = "smart" | "proportional" | "pixel" | "off";

export const SYNC_MODES: { id: SyncMode; label: string; hint: string }[] = [
  { id: "smart", label: "Smart align", hint: "Keeps matching content level, even when pages differ in length" },
  { id: "proportional", label: "Proportional", hint: "Same percentage through each page" },
  { id: "pixel", label: "Pixel for pixel", hint: "Identical scroll distance" },
  { id: "off", label: "Independent", hint: "Scroll each page on its own" },
];
