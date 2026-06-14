# Dependency Link API Examples

## Overview

The DependencyLink API tracks compositional "uses" relationships between any versioned entities (assets, containers, etc.). Unlike VersionLink (lineage/generation), this models structural dependencies: "Model A uses Material B", "Container A uses Scene Template B".

## Setup: Create Versions

Assume we have versions:
- Model_v1 (id=1, type=media_asset)
- Material_v1 (id=2, type=media_asset)
- Board_v1 (id=3, type=container)
- CharLib_v1 (id=4, type=container)

## 1. Create Dependency Links

**Model v1 uses Material v1**

```bash
curl -X POST http://localhost:8000/api/dependency-links/create_link/ \
  -H "Content-Type: application/json" \
  -d '{
    "source_version_id": 1,
    "target_version_id": 2,
    "relationship_type": "uses",
    "role": "material"
  }'
```

**Response:**
```json
{
  "id": 42,
  "source_version_id": 1,
  "target_version_id": 2,
  "relationship_type": "uses",
  "role": "material",
  "source_entity": {
    "version_id": 1,
    "entity_id": 10,
    "entity_name": "Model",
    "entity_type": "media_asset",
    "version_number": 1
  },
  "target_entity": {
    "version_id": 2,
    "entity_id": 20,
    "entity_name": "Material",
    "entity_type": "media_asset",
    "version_number": 1
  },
  "created_at": "2026-06-12T10:30:00Z"
}
```

**Board v1 uses CharLib v1**

```bash
curl -X POST http://localhost:8000/api/dependency-links/create_link/ \
  -H "Content-Type: application/json" \
  -d '{
    "source_version_id": 3,
    "target_version_id": 4,
    "relationship_type": "uses",
    "role": "character_library"
  }'
```

## 2. Query: What Does Version X Use?

```bash
curl http://localhost:8000/api/dependency-links/what_it_uses/?version_id=1
```

**Response:**
```json
{
  "version_id": 1,
  "uses": [
    {
      "id": 42,
      "relationship_type": "uses",
      "role": "material",
      "source_entity": {
        "entity_name": "Model",
        "entity_type": "media_asset",
        "version_number": 1
      },
      "target_entity": {
        "entity_name": "Material",
        "entity_type": "media_asset",
        "version_number": 1
      }
    }
  ]
}
```

## 3. Query: What Uses Version X? (Impact Analysis)

```bash
curl http://localhost:8000/api/dependency-links/what_uses/?version_id=2
```

**Response:**
```json
{
  "version_id": 2,
  "used_by": [
    {
      "id": 42,
      "relationship_type": "uses",
      "role": "material",
      "source_entity": {
        "entity_name": "Model",
        "entity_type": "media_asset",
        "version_number": 1
      },
      "target_entity": {
        "entity_name": "Material",
        "entity_type": "media_asset",
        "version_number": 1
      }
    }
  ]
}
```

## 4. Full Dependency Graph (Recursive)

**What does version X depend on (recursively)?**

```bash
curl http://localhost:8000/api/dependency-links/dependency_graph/?version_id=1&max_depth=10
```

**Response:**
```json
{
  "source": {
    "id": 1,
    "entity_id": 10,
    "entity_name": "Model",
    "entity_type": "media_asset",
    "version": 1
  },
  "direct_dependencies": [
    {
      "target": {
        "id": 2,
        "entity_id": 20,
        "entity_name": "Material",
        "entity_type": "media_asset",
        "version": 1
      },
      "relationship_type": "uses",
      "role": "material"
    }
  ],
  "total": 1
}
```

## Use Cases

### Reproducibility
Track exactly which versions were used:
```python
# Later, when Model v2 is created, compare dependencies
old_deps = Model_v1.uses.all()
new_deps = Model_v2.uses.all()
# See what changed
```

### Impact Analysis
Find everything affected when a dependency changes:
```bash
# Material v1 → v2: who's using it?
curl http://localhost:8000/api/dependency-links/what_uses/?version_id=2
# → Returns all versions that will be affected by Material update
```

### Dependency Visualization
Build graph showing hierarchical dependencies:
```
Model v1
├─ uses: Material v1
│  └─ imports: ColorLibrary v2
└─ references: Mesh v3
   └─ uses: Texture v1

Board v1
└─ uses: CharLib v1
   └─ depends_on: ComponentLib v1
```

### Version Migration
When updating what a version uses:
```bash
# Model v2 uses Material v2 instead
POST /api/dependency-links/create_link/
{
  "source_version_id": 5,     # Model v2
  "target_version_id": 6,     # Material v2
  "relationship_type": "uses",
  "role": "material"
}
```

## Query Performance

Indexes optimized for common queries:
- **What does X use?** → indexed on `(source_version, relationship_type)`
- **What uses X?** → indexed on `target_version`
- **Filter by type** → indexed on `relationship_type`

Recursive queries (via CTE) support `max_depth` parameter:
- Default: `max_depth=10`
- Reduces exponential blowup in deep dependency trees
- Returns depth + path for visualization
