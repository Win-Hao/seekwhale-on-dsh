/**
 * Seek, node half. Pure UI plugin: the empty apply exists only so the entry
 * appears in the profile's plugin tree, which is what makes the host look at
 * package.json and discover the browser half through exports["./client"].
 */
/** Host plugin body — this plugin has no host-side behaviour. */
export function apply() {}
