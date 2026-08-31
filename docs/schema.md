# Thakur Bites — Firestore Collections Schema Specification

## 1. Collections Overview

| Collection | Client Access | Write Method | Description |
|---|---|---|---|
| `menuItems` | Read (Public) | Trusted Backend Only | Dish catalog, base pricing, categories, station routing |
| `inventory` | Staff Read (Restricted) | Trusted Backend Transaction | Granular stock levels (`stockOnHand`, `reservedStock`, `lowStockThreshold`) |
| `inventoryLedger` | Admin/Manager Read | Append-Only (Backend) | Immutable ledger of all stock changes with actor & order reference |
| `orders` | Student Read (Own), Staff Read (By Role) | Trusted Backend Transaction | Orders, tokens, snapshot pricing, status, pickup code hash |
| `orderEvents` | Student Read (Own), Staff Read (All) | Append-Only (Backend) | Immutable history of status transitions |
| `students` | Student Read/Write (Self only) | Client / Backend | Profile, roll number, verification status, preferences |
| `staffUsers` | Staff Read (Self/Admin) | Admin Backend Only | Staff identity, assigned stations, role, active status |
| `securityEvents` | Security Admin Read Only | Append-Only (Backend) | Audit logs for authentication failures, replay attempts, anomalies |
| `counters` | No Client Access | Backend Transaction | Daily sequence counters for tokens (`TB-001`) |

---

## 2. Granular Schemas

### `inventory/{itemId}`
```typescript
interface InventoryRecord {
  itemId: string;
  name: string;
  type: 'cooked' | 'instant';
  stockOnHand: number;       // Physical units in canteen storage
  reservedStock: number;     // Units in confirmed orders awaiting preparation/pickup
  availableStock: number;    // stockOnHand - reservedStock
  soldToday: number;         // Cumulative units sold today
  wasteToday: number;        // Units damaged or spoiled
  lowStockThreshold: number; // Alerts triggered when availableStock <= threshold
  lastRestockedAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `inventoryLedger/{ledgerId}` (Immutable Append-Only)
```typescript
interface InventoryLedgerEntry {
  id: string;
  itemId: string;
  orderId?: string;
  changeType: 'CHECKOUT_RESERVE' | 'ORDER_COLLECTED' | 'ORDER_CANCELLED_RESTOCK' | 'MANUAL_RESTOCK' | 'WASTE_WRITE_OFF';
  deltaUnits: number;        // e.g. -2, +50
  previousAvailable: number;
  newAvailable: number;
  actorId: string;           // 'SYSTEM_CHECKOUT' or staff uid
  timestamp: Timestamp;
  notes?: string;
}
```

### `orders/{orderId}`
```typescript
interface OrderRecord {
  id: string;
  idempotencyKey: string;
  tokenNumber: string;        // 'TB-001' (Daily sequential)
  pickupCodeHash: string;     // SHA-256 hash of single-use verification token/PIN
  studentId: string;
  studentName: string;
  studentRoll: string;
  status: 'draft' | 'payment_pending' | 'paid' | 'confirmed' | 'preparing' | 'ready' | 'collected' | 'cancelled';
  paymentStatus: 'unpaid' | 'pending' | 'paid' | 'refunded';
  totalAmount: number;        // Authoritatively calculated by backend
  currency: 'INR';
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;        // Snapshot price at checkout time
    subtotal: number;
    type: 'cooked' | 'instant';
    station: string;          // 'dosa' | 'counter' | 'chinese' | 'beverage'
  }>;
  estimatedMinutes: number;
  createdAt: Timestamp;
  confirmedAt?: Timestamp;
  readyAt?: Timestamp;
  collectedAt?: Timestamp;
  collectedByStaffId?: string;
}
```

### `orderEvents/{eventId}` (Immutable Transition History)
```typescript
interface OrderEvent {
  id: string;
  orderId: string;
  fromStatus: string;
  toStatus: string;
  actorId: string;
  actorRole: 'student' | 'kitchen' | 'pickup' | 'manager' | 'admin' | 'system';
  timestamp: Timestamp;
  metadata?: Record<string, any>;
}
```
