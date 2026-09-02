export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc',
      // Statuses use calmer hues than the raw defaults: the brand green scale
      // (see main.css) is too neon for a "passed" chip, and pure red/yellow
      // read harsh next to it. Emerald/rose/amber keep the same meaning with
      // a softer, more even palette.
      success: 'emerald',
      error: 'rose',
      warning: 'amber',
    },
    card: {
      slots: {
        // Solid muted header so block headers clearly separate from the card
        // body in both modes (zinc-100 on white / zinc-800 on zinc-900).
        header: 'px-3 py-3 sm:px-6 bg-muted',
      },
    },
    table: {
      slots: {
        // Reduce default table cell padding globally (default is px-4 py-3.5 / p-4)
        th: 'px-3 py-2',
        td: 'px-3 py-2',
      },
    },
  },
});
