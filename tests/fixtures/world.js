export function worldPack(options = {}) {
    return {
        id: options.id ?? 'fixture',
        version: options.version ?? '2.0.0',
        name: options.name ?? 'Fixture',
        requires: { storyBlock: '^2' },
        content: {
            items: [], creatures: [], shops: [], recipes: [], quests: [],
            places: options.places ?? [
                { slug: 'haven', name: 'Haven', x: 0, y: 0 },
                { slug: 'mill', name: 'Mill', x: 1, y: 0 },
            ],
            ...(options.routes !== undefined ? { routes: options.routes } : {}),
        },
    };
}
