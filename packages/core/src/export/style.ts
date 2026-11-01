/**
 * The scene's own stylesheet, applied without a browser.
 *
 * The renderer puts no colour in the markup: classes resolve to
 * `var(--tl-*)` in the `<style>` the scene carries. A browser applies that;
 * a PDF has to be told each fill and stroke. This reads the rules the core
 * itself writes — a root rule with the theme's tokens, then a class or two
 * under the root — and gives each node its computed style, with SVG's
 * inheritance. It is not a CSS engine: an at-rule, a pseudo-class or an
 * attribute selector below the root is skipped, and of a descendant chain
 * only the last step is matched. The rules the core writes need no more,
 * and the frame to export is pinned to one theme, so the `@media` blocks
 * that `auto` adds are not needed either.
 */

import type { SceneElement } from "../scene.js";

/** A node's computed properties, by CSS name. */
export type ComputedStyle = Readonly<Record<string, string>>;

interface Rule {
  readonly tag: string | undefined;
  readonly classes: readonly string[];
  readonly weight: number;
  readonly decls: readonly (readonly [string, string])[];
}

/** A stylesheet, parsed. */
export interface StyleSheet {
  readonly rules: readonly Rule[];
  readonly vars: ReadonlyMap<string, string>;
}

/** What a child takes from its parent in SVG. */
const INHERITED = new Set([
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "color",
  "font-size",
  "font-weight",
  "font-family",
  "text-anchor",
  "dominant-baseline",
  "visibility",
]);

/** Attributes that are also properties. A rule beats them; a `style` attribute beats a rule. */
const PRESENTATION = [...INHERITED, "opacity", "display"];

function declsOf(body: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out.push([part.slice(0, at).trim(), part.slice(at + 1).trim()]);
  }
  return out;
}

/** Rules and tokens of a stylesheet's text. */
export function parseStyleSheet(css: string): StyleSheet {
  const rules: Rule[] = [];
  const vars = new Map<string, string>();
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    if (open < 0) break;
    const selector = css.slice(at, open).trim();
    if (selector.startsWith("@")) {
      // Skip the block, nested braces and all.
      let depth = 1;
      let cursor = open + 1;
      while (depth > 0 && cursor < css.length) {
        const ch = css[cursor];
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        cursor += 1;
      }
      at = cursor;
      continue;
    }
    const close = css.indexOf("}", open);
    const decls = declsOf(css.slice(open + 1, close < 0 ? css.length : close));
    at = close < 0 ? css.length : close + 1;
    for (const one of selector.split(",")) {
      const steps = one.trim().split(/\s*>\s*|\s+/);
      const last = steps[steps.length - 1] ?? "";
      if (steps.some((step) => step.includes(":")) || (steps.length > 1 && last.includes("["))) continue;
      const classes = [...last.matchAll(/\.([\w-]+)/g)].map((match) => match[1] as string);
      const tag = /^[a-zA-Z]+/.exec(last)?.[0];
      if (steps.length === 1) {
        for (const [name, value] of decls) if (name.startsWith("--")) vars.set(name, value);
      }
      rules.push({ tag, classes, weight: steps.join(" ").split(".").length - 1, decls });
    }
  }
  // Specificity, and the source order where it ties: a stable sort.
  return { rules: rules.sort((a, b) => a.weight - b.weight), vars };
}

/** Every `<style>` in a scene, as one sheet. */
export function sheetOf(scene: SceneElement): StyleSheet {
  let css = "";
  const walk = (node: SceneElement): void => {
    if (node.tag === "style") css += node.text ?? "";
    for (const child of node.children ?? []) walk(child);
  };
  walk(scene);
  return parseStyleSheet(css);
}

function resolveVars(value: string, vars: ReadonlyMap<string, string>): string {
  return value.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name: string, fallback?: string) => vars.get(name) ?? fallback ?? "");
}

/** A node's style: what it inherits, its attributes, the rules that match it, its `style`. */
export function computeStyle(node: SceneElement, parent: ComputedStyle, sheet: StyleSheet): ComputedStyle {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) if (INHERITED.has(name)) out[name] = value;
  const attrs = node.attrs ?? {};
  for (const name of PRESENTATION) {
    const value = attrs[name];
    if (value !== undefined) out[name] = String(value);
  }
  const classes = new Set(String(attrs.class ?? "").split(/\s+/));
  for (const rule of sheet.rules) {
    if (rule.tag !== undefined && rule.tag !== node.tag) continue;
    if (!rule.classes.every((name) => classes.has(name))) continue;
    for (const [name, value] of rule.decls) out[name] = value;
  }
  if (typeof attrs.style === "string") for (const [name, value] of declsOf(attrs.style)) out[name] = value;
  for (const [name, value] of Object.entries(out)) out[name] = resolveVars(value, sheet.vars);
  return out;
}
