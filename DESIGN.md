---
name: Executive Campaign Operations
colors:
  surface: '#fbf8ff'
  surface-dim: '#d7d8ef'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f2ff'
  surface-container: '#ececff'
  surface-container-high: '#e5e6fe'
  surface-container-highest: '#e0e1f8'
  on-surface: '#181b2b'
  on-surface-variant: '#464555'
  inverse-surface: '#2d2f41'
  inverse-on-surface: '#f0efff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4c43e5'
  primary: '#2100bd'
  on-primary: '#ffffff'
  primary-container: '#3b2fd6'
  on-primary-container: '#bcbbff'
  inverse-primary: '#c2c1ff'
  secondary: '#835400'
  on-secondary: '#ffffff'
  secondary-container: '#ffad2e'
  on-secondary-container: '#6c4400'
  tertiary: '#003c58'
  on-tertiary: '#ffffff'
  tertiary-container: '#00547a'
  on-tertiary-container: '#79c9ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c2c1ff'
  on-primary-fixed: '#0e006a'
  on-primary-fixed-variant: '#3121ce'
  secondary-fixed: '#ffddb5'
  secondary-fixed-dim: '#ffb957'
  on-secondary-fixed: '#2a1800'
  on-secondary-fixed-variant: '#643f00'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#89ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#fbf8ff'
  on-background: '#181b2b'
  surface-variant: '#e0e1f8'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  metric-tabular:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.25rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 1.75rem
---

## Brand & Style

This design system delivers a calm, high-precision operations console for mission-critical election campaigns. Designed with the exacting discipline of modern tier-one infrastructure software (Linear, Stripe Dashboard, Notion Calendar), it strips away political spectacle in favor of logistical command, predictive intelligence, and operational velocity.

### Design Movement: Modern Precision Enterprise
The aesthetic blends structural minimalism with subtle tactile depth:
- **Zero Political Allegiance:** A non-partisan, neutral instrument palette focused strictly on voter mobilization, precinct logistics, live canvass telemetry, and resource allocation.
- **Data-Dense Elegance:** Tight typographic tracking, tabular numeric alignment, and compact spatial balance ensure information density without visual exhaustion.
- **Instrument-Grade Tactility:** Subdued surfaces anchored by crisp, low-contrast boundaries (1px subtle strokes), micro-radii, and controlled translucent glass layers for floating navigation states.

## Colors

The palette establishes an authoritative, reliable environment that prioritizes signal-to-noise ratio over decoration.

### Light Mode (Default)
- **Primary Canvas (`bg`):** `#F6F7FB` — Soft, balanced slate-tinted canvas preventing optical fatigue during intense field sessions.
- **Surface Elevation (`card`):** `#FFFFFF` — Crisp, pure white card layer ensuring maximum contrast against the foundation.
- **Hairline Dividers (`border`):** `#E4E7F0` — Architectural bounding lines providing structural definition without visual clutter.
- **Primary Text (`text-primary`):** `#0F1222` — Deep ink neutral for ultra-sharp legibility across field lighting conditions.
- **Secondary Text (`text-secondary`):** `#5B6178` — Muted slate for metadata, tabular labels, and secondary indicators.

### Dark Mode
- **Primary Canvas (`bg`):** `#0B0D14` — Deep obsidian base reducing glare in night-time war rooms and nocturnal canvassing.
- **Surface Elevation (`card`):** `#141824` — Elevated slate container layer separating data clusters.
- **Hairline Dividers (`border`):** `#262C3F` — Low-contrast structural borders.
- **Primary Text (`text-primary`):** `#F2F4FA` — High-luminance crisp neutral text.
- **Secondary Text (`text-secondary`):** `#9AA2BC` — Calibrated mid-tone neutral for contextual subtext.

### Functional Accents
- **Primary (`#3B2FD6`):** Deep Indigo — High-confidence operational focus, key interactions, primary actions, and selected states.
- **Accent / Metric Highlight (`#F5A524`):** Operational Amber — Critical milestones, key swing metrics, and high-priority field quotas.
- **Status Success (`#16A34A`):** Verified turnout targets, completed canvass paths, and reconciled budgets.
- **Status Warning (`#F59E0B`):** Precinct anomalies, staffing bottlenecks, and resource drift.
- **Status Danger (`#DC2626`):** Critical voter deficit alerts, unstaffed polling sites, and logistical failures.
- **Status Info (`#0EA5E9`):** Tactical field announcements, geo-fence updates, and route synchronizations.

## Typography

The type system is built on **Inter**, optimized for density and instant parsing.

### Tabular Numbers & Data Glyphs
All quantitative layers (precinct margins, voter turnout, volunteer counts, clock cycles) must explicitly enforce OpenType features: `font-feature-settings: "tnum" 1, "cv05" 1, "cv08" 1`. This guarantees numbers align vertically in real-time streaming dashboards, preventing optical jitter during metric increments.

### Hierarchy Rules
- **Headline XL / Large:** Reserved for top-tier metrics and primary view titles.
- **Headline Medium / Small:** Section grouping headers and operational partition labels.
- **Body & Labels:** Functional text layers rendered with tight negative tracking on larger sizes, transitioning to positive micro-tracking at sizes `<= 12px` to preserve legibility on high-DPI mobile screens.
- **Micro Labels (`label-sm`):** All-caps rendering for status pill indicators, table headers, and category tags.

## Layout & Spacing

The layout employs a mobile-first, strict 4px/8px incremental base grid.

### Mobile Grid & Safe Areas
- **Mobile Foundation:** Single-column layout spanning a max-width of 480px, inset by `margin-mobile` (16px).
- **Internal Gutters:** 12px column gutters for split micro-stat grids (2-column key performance indicators).
- **Safe Area Insets:** Strict adherence to bottom edge boundaries (`env(safe-area-inset-bottom) + 64px`) to accommodate the frosted glass floating command bar without content occlusion.

### Spatial Rhythms
- **`space-xs` (4px):** Micro gaps between icons and labels, badge internal vertical padding.
- **`space-sm` (8px):** Compact element gaps, tag horizontal padding, input group inner spacing.
- **`space-md` (12px):** Card-internal section splits and compact list gaps.
- **`space-lg` (20px):** Structural card internal padding and inter-component card stacks.
- **`space-xl` (28px):** Major dashboard section dividers.

## Elevation & Depth

Visual hierarchy is maintained through precision surface layering, low-contrast 1px perimeter outlines, and targeted optical glassmorphism rather than heavy diffused shadows.

### Surface Tiers & Boundaries
- **Layer 0 (Canvas):** Ambient background (`#F6F7FB` light / `#0B0D14` dark).
- **Layer 1 (Card Container):** Raised surface (`#FFFFFF` light / `#141824` dark) framed with a uniform hairline perimeter stroke (`1px solid #E4E7F0` light / `#262C3F` dark).
- **Layer 2 (Overlays & Modals):** High-priority detail sheets rendered with an ultra-subtle contextual shadow: `0 8px 30px rgba(15, 18, 34, 0.06)` in light mode, and `0 8px 30px rgba(0, 0, 0, 0.40)` in dark mode.

### Frosted Navigation Surface
The bottom command bar floats detached from the screen perimeter:
- **Backdrop Blur:** 20px blur with `saturate(180%)`.
- **Translucent Fill:** Light mode `rgba(255, 255, 255, 0.82)`, Dark mode `rgba(20, 24, 36, 0.82)`.
- **Upper Perimeter Stroke:** `1px solid rgba(228, 231, 240, 0.6)` light / `1px solid rgba(38, 44, 63, 0.6)` dark.

## Shapes

The design system uses a strict 3-tier corner geometry to establish a polished, tactile feel:

- **Cards & Primary Modules:** Fixed `20px` border-radius (`rounded-xl`). Balances visual softness with high-density card containment.
- **Interactive Controls (Inputs, Buttons, Dropdowns):** Fixed `14px` border-radius (`rounded-lg`). Ensures an ergonomic, tactile thumb-target target zone while visually nesting cleanly inside cards.
- **Indicators & Chips:** Fully pill-shaped `9999px` (`rounded-full`). Used for active state indicators, filter toggles, precinct tags, and quick-filter pills.

## Components

### Buttons
- **Primary:** Background `#3B2FD6`, label `#FFFFFF`, border-radius `14px`, height `48px` (mobile thumb target). Pressed state scales to `0.98` with a subtle overlay tint.
- **Secondary / Ghost:** Transparent or card background, 1px stroke (`#E4E7F0` / `#262C3F`), label text (`#0F1222` / `#F2F4FA`).
- **Critical Action:** Background `#DC2626` with pure white typography for high-stakes operational overrides.

### Input Fields
- **Architecture:** Height `48px`, border-radius `14px`, 1px solid stroke (`#E4E7F0` light / `#262C3F` dark), background `#FFFFFF` (light) / `#141824` (dark).
- **Active / Focus:** Border transitions instantly to `#3B2FD6` with an outer focus ring: `0 0 0 3px rgba(59, 47, 214, 0.12)`.
- **Field Micro-Copy:** Fixed 12px secondary labels situated outside or as crisp inline badges.

### Chips & Filter Pills
- **Geometry:** Height `28px`, border-radius `9999px`, horizontal padding `12px`.
- **Default:** Subtle tinted surface with low-contrast border, label `label-md`.
- **Selected:** Indigo background `#3B2FD6` with white text, or Amber `#F5A524` with deep ink neutral `#0F1222` when signifying active urgent filters.

### Cards & Telemetry Containers
- **Border Radius:** `20px`.
- **Padding:** 16px to 20px.
- **Structure:** Crisp top row housing a category micro-label (`label-sm`, uppercase) paired with a real-time status pip. Mid-tier houses the tabular metric (`headline-xl-mobile` with `font-feature-settings: "tnum" 1`), and bottom section holds progression rails or delta comparisons.

### Lists & Activity Feeds
- **Dividers:** 1px hairpins matching system border tokens, inset by text margin to preserve clean vertical scanning lines.
- **List Items:** Minimum height `56px` to maintain touch ergonomics, featuring trailing tabular metrics or directional chevrons (`16px`).

### Tactical Floating Navigation Bar
- **Positioning:** Floating anchored dock, elevated 12px above bottom safe area, inset 16px on lateral sides.
- **Material:** Translucent frosted glass with `20px` corner rounding.
- **Item States:** Default icon rendered in `text-secondary`; selected icon dynamically transitions to `#3B2FD6` alongside a micro 4px indicator pip centered beneath.