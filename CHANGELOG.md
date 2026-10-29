# Changelog

## 0.2.0

- RPG Battle is no longer supported. Its rules packs cannot be imported; existing RPG Battle chats should stay on the previous versions.
- Studio edits ordinary worlds, including places, routes, calendar, weather, events and data modules, using Story Block 2.6's pack checker.
- The screen builder offers only what works in the suite: a new button no longer calls `inventory.grant` (refused from a button) but drops one of a list row's item, or waits for a command, and **Reader command** lists the commands a button may run. The query list drops `scene.map` and `party.pc`, which no suite module answers, and adds `scene.present`; a new screen starts on `scene.place`.
