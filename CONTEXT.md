# Perfect Pi Workflow

Perfect Pi routes engineering work through explicit, resumable workflows.

## Language

**Implementation ticket**:
A single verifiable slice of an agreed change, with declared prerequisites and a completion outcome. _Avoid_: step, task list item

**Triage role**:
A classification of whether an issue is ready for an agent or requires another kind of attention. It does not describe implementation progress. _Avoid_: execution status

**Execution state**:
The progress of an implementation ticket from available work through an active claim to verified completion. It is independent of the ticket's triage role. _Avoid_: triage label

**Claim**:
A durable association between an implementation ticket and the run and branch responsible for its current attempt. A claim is not evidence that the ticket is complete. _Avoid_: completion

**Frontier**:
The implementation tickets whose prerequisites are complete and that are available to claim. _Avoid_: entire backlog
