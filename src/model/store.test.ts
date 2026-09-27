import { expect, it } from 'vitest';
import { useStore } from './store';

it('begin without a change records no undo step; a drag records exactly one', () => {
  const s = useStore.getState;
  s().begin();
  expect(s().past).toHaveLength(0);
  s().begin();
  s().live(p => ({ ...p, settings: { ...p.settings, ceilingHeight: 3 } }));
  s().live(p => ({ ...p, settings: { ...p.settings, ceilingHeight: 3.1 } }));
  expect(s().past).toHaveLength(1);
  s().undo();
  expect(s().plan.settings.ceilingHeight).toBe(2.5);
});
