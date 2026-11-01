/** Props a test can change after mount: a `$state` proxy, which only a `.svelte.ts` module may make. */
export function reactiveProps<P extends Record<string, unknown>>(initial: P): P {
  const props = $state(initial);
  return props;
}
