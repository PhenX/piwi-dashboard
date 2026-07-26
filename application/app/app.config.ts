export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc',
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
