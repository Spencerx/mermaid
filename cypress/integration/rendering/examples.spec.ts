import { diagramData } from '../../../packages/examples/src/index.ts';
import { imgSnapshotTest } from '../../helpers/util.ts';

describe('diagram examples', () => {
  for (const diagram of diagramData) {
    describe(diagram.name, () => {
      for (const example of diagram.examples) {
        it(`renders ${example.title}`, () => {
          imgSnapshotTest(example.code, {
            // Example titles can contain characters that are unsafe in
            // screenshot file names (e.g. `/`), so build a sanitized name
            // instead of relying on the test title.
            name: `examples-${diagram.id}-${example.title}`.replace(/\W+/g, '-'),
          });
        });
      }
    });
  }
});
