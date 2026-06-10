import type { DiagramMetadata } from '../types.js';

export default {
  id: 'kanban',
  name: 'Kanban Diagram',
  description: 'Visualize work items in a Kanban board',
  examples: [
    {
      title: 'Sprint Board',
      isDefault: true,
      code: `---
config:
  kanban:
    ticketBaseUrl: 'https://github.com/your-org/your-repo/issues/#TICKET#'
---
kanban
  todo[Backlog]
    t1[Design new landing page]
    t2[Update API documentation]@{ priority: 'Low' }
  doing[In Progress]
    t3[Fix login redirect bug]@{ ticket: 1234, assigned: 'alice', priority: 'Very High' }
    t4[Migrate database to v2]@{ assigned: 'bob' }
  review[In Review]
    t5[Add dark mode support]@{ ticket: 1198, assigned: 'carol', priority: 'High' }
  done[Done]
    t6[Set up CI pipeline]
    t7[Release v2.1.0]@{ ticket: 1150 }`,
    },
    {
      title: 'Personal Task Board',
      code: `kanban
  Todo
    [Buy groceries]
    [Book dentist appointment]
  [In progress]
    [Plan weekend trip]
  Done
    [Pay electricity bill]
    [Renew gym membership]`,
    },
  ],
} satisfies DiagramMetadata;
