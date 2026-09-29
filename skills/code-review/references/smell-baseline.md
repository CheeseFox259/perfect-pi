# Standards smell baseline

Fowler's code smells (*Refactoring*, chapter 3) are judgement calls, not violations. Prefix them with “possible”; quote evidence and explain the consequence. A documented repository rule overrides this baseline. Skip anything tooling enforces.

- **Mysterious Name:** a name conceals what something does or holds. Rename; inability to name it may expose unclear design.
- **Duplicated Code:** repeated logic shapes across the change. Extract the shared behavior when that improves clarity.
- **Feature Envy:** a method uses another object's data more than its own. Consider moving behavior to that owner.
- **Data Clumps:** the same fields or parameters travel together. Consider a coherent type.
- **Primitive Obsession:** a primitive obscures a domain concept. Consider a small domain type.
- **Repeated Switches:** repeated branching on the same type. Consider one map or polymorphism.
- **Shotgun Surgery:** one logical change requires scattered edits. Gather what changes together.
- **Divergent Change:** one module changes for unrelated reasons. Separate responsibilities.
- **Speculative Generality:** abstractions or hooks for requirements that do not exist. Remove until needed.
- **Message Chains:** callers navigate deep object structure. Hide that navigation behind behavior on an appropriate owner.
- **Middle Man:** a module mostly forwards without adding value. Consider calling the real target directly.
- **Refused Bequest:** an implementer ignores most inherited behavior. Consider composition instead.
