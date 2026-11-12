# Admin dashboard: Hybrid look

Replace these three files in your `admin/` folder.

## admin/admin.css (rewritten, same class names)
- Colours: near-black panels with the violet accent (#a78bfa). If your computer is in light mode you get a pale violet-paper version with a deeper violet.
- Fonts: Archivo for text, Martian Mono for tabs, buttons, labels and small details.
- Tabs: mono labels, violet underline on the active tab, violet count badge on Queue and Published.
- Buttons: square with a cut top-right corner; the main one is solid violet; Delete turns red on hover.
- Queue cards and forms: dark panels with a cut corner; queue cards also have a violet left edge. Scraper/post badges and flag lists use the orange warning colour.
- Fields: square, violet border and outline when focused; checkboxes use the accent colour.
- Published table: rows highlight in violet on hover. Organiser logos are round, like the calendar.
- Title: small violet square with a cut corner, matching the calendar's brand mark.
- Keyboard focus is visible everywhere; button animation is off if the device asks for reduced motion.

## admin/index.html
- Adds the Google Fonts link for Archivo and Martian Mono (the admin needs internet for the fonts; without it, it falls back to system fonts).

## admin/admin.js (bug fix, one line)
- The Organisers form showed the word "null" next to "Add organiser" (a missing Cancel button was being drawn as text). It now adds the button only when editing.
