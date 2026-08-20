# F12 MUSICAL EVENT CONTRACT

## Events in ComposedBar

### Kick events
- `kickNotes: number[]` — step indices within the bar
- Consumer interprets: at step N, trigger kick synth
- No pitch (kick is percussion)
- Velocity implied by groove density

### Bass events
- `bassNotes: { midi: number; step: number; durationSteps: number; function: string }[]`
- `midi`: MIDI note number (typically octave 2, MIDI 36-59)
- `step`: step index within bar
- `durationSteps`: duration in 16th-note steps
- `function`: "ROOT" | "FIFTH" | "OCTAVE" | "PASSING" | "APPROACH" | "ANTICIPATION" | "CADENCE"

### Lead events
- `leadNotes: { midi: number; step: number; durationSteps: number; velocity: number }[]`
- `midi`: MIDI note number (typically octave 4+, MIDI 60-84)
- `step`: step index within bar
- `durationSteps`: duration in 16th-note steps
- `velocity`: 0..1

### Hat events
- `hatNotes: number[]` — step indices
- Consumer interprets: at step N, trigger hat synth
- Velocity implied by groove

### Rest semantics
- Absence of notes = rest. If `leadNotes` is empty, the lead is silent for that bar.
- This is intentional (arrangement decision): BREAK sections have lead exposed, DROP sections have lead selective.
- Consumer must NOT generate fallback notes when leadNotes is empty.

### Harmonic context
- `harmonicContext: number[]` — active chord pitch classes (0-11)
- Consumer can use this for filter tuning, FM ratios, etc.
- Foundation guarantees lead/bass notes are harmonically compatible with this context.

### Role activation
- `roles: RoleActivation` — { kick: boolean, bass: boolean, lead: boolean, hats: boolean, percussion: boolean, fills: boolean, texture: boolean }
- If `kick: false`, consumer must NOT play kick even if kickNotes is non-empty (defensive).
- If `lead: false`, consumer must NOT play lead even if leadNotes is non-empty.
