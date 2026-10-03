# Mermaid verification

## 1. Flowchart

```mermaid
flowchart LR
    A[Start] --> B{Ready?}
    B -->|Yes| C[Done]
    B -->|No| A
```

## 2. Sequence

```mermaid
sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi
```

## 3. State

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Running: Start
    Running --> [*]: Finish
```

## 4. Class

```mermaid
classDiagram
    class Animal {
        +String name
        +speak()
    }
    class Dog
    Animal <|-- Dog
```

## 5. Entity relationship

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
        int id PK
        string name
    }
    ORDER {
        int id PK
        int customer_id FK
    }
```

## 6. XY line chart

```mermaid
xychart-beta
    title "Line test"
    x-axis [Mon, Tue, Wed]
    y-axis "Score" 0 --> 100
    line [30, 80, 50]
```

## 7. XY bar chart

```mermaid
xychart-beta
    title "Bar test"
    x-axis [Mon, Tue, Wed]
    y-axis "Count" 0 --> 100
    bar [30, 80, 50]
```

## 8. Pie

```mermaid
pie title Test results
    "Passed" : 70
    "Failed" : 30
```

## 9. Gantt

```mermaid
gantt
    title Release plan
    dateFormat YYYY-MM-DD
    section Work
    Build :a1, 2026-10-01, 2d
    Test :after a1, 1d
```

## 10. User journey

```mermaid
journey
    title Checkout
    section Purchase
      Browse: 5: Customer
      Pay: 3: Customer
      Receive: 5: Customer
```

## 11. Git graph

```mermaid
gitGraph
    commit
    branch feature
    checkout feature
    commit
    checkout main
    merge feature
```

## 12. Mind map

```mermaid
mindmap
    root((Project))
        Frontend
            UI
        Backend
            API
```

## 13. Timeline

```mermaid
timeline
    title Release history
    2024 : Prototype
    2025 : Beta
    2026 : Launch
```

## 14. Quadrant chart

```mermaid
quadrantChart
    title Task priority
    x-axis Low effort --> High effort
    y-axis Low impact --> High impact
    quadrant-1 Plan
    quadrant-2 Do now
    quadrant-3 Later
    quadrant-4 Reconsider
    Fix: [0.2, 0.8]
    Rewrite: [0.8, 0.6]
```

## 15. Requirement diagram

```mermaid
requirementDiagram
    requirement rendering {
        id: 1
        text: Display a diagram
        risk: low
        verifymethod: test
    }
    element client {
        type: application
    }
    client - satisfies -> rendering
```

## 16. Sankey

```mermaid
sankey-beta

Source,Process,100
Process,Success,80
Process,Failure,20
```

## 17. Block diagram

```mermaid
block-beta
    columns 3
    A["Input"] B["Process"] C["Output"]
    A --> B
    B --> C
```

## 18. Packet diagram

```mermaid
packet-beta
    0-7: "Header"
    8-15: "Flags"
    16-31: "Payload"
```

## 19. Architecture

```mermaid
architecture-beta
    service api(server)[API]
    service db(database)[Database]
    api:R -- L:db
```

## 20. Kanban

```mermaid
kanban
    todo[Todo]
        task1[Build chart]
    done[Done]
        task2[Test flowchart]
```

## 21. Flowchart with YAML configuration

```mermaid
---
config:
  theme: dark
---
flowchart LR
    A[Start] --> B{Ready?}
    B -->|Yes| C[Done]
    B -->|No| A
```

## 22. XY chart with YAML configuration

```mermaid
---
config:
  themeVariables:
    xyChart:
      plotColorPalette: "#3b82f6, #f97316"
---
xychart-beta
    title "Configured line test"
    x-axis [Mon, Tue, Wed]
    y-axis "Score" 0 --> 100
    line [30, 80, 50]
    line [60, 40, 70]
```
