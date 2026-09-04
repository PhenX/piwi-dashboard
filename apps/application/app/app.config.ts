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
        // Below `sm` the header adds 10 px per side; from `sm` up it is `px-6`.
        header: 'px-2.5 py-3 sm:px-6 bg-muted',
        // Below `sm` a card adds 10 px of its own; with the 8 px panel gutter the
        // first text stays within 20 px of the edge. From `sm` up the Nuxt UI
        // default (`p-6`) applies.
        body: 'max-sm:p-2.5',
        footer: 'max-sm:p-2.5',
      },
    },
    dashboardPanel: {
      slots: {
        // Below `sm` the page gutter is 8 px per side: small enough that a card's
        // own padding keeps text within 20 px of the edge, large enough to hold
        // panel-level controls (not wrapped in a card) off the edge. Vertical
        // padding and the `sm`-and-up default (`p-6`) are the Nuxt UI defaults.
        body: 'max-sm:px-2',
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
