"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPickup = exports.assignStaffRole = exports.updateOrderStatus = exports.createCheckout = void 0;
const admin = require("firebase-admin");
if (!admin.apps.length) {
    admin.initializeApp();
}
var checkout_1 = require("./checkout");
Object.defineProperty(exports, "createCheckout", { enumerable: true, get: function () { return checkout_1.createCheckout; } });
var order_state_1 = require("./order_state");
Object.defineProperty(exports, "updateOrderStatus", { enumerable: true, get: function () { return order_state_1.updateOrderStatus; } });
var auth_roles_1 = require("./auth_roles");
Object.defineProperty(exports, "assignStaffRole", { enumerable: true, get: function () { return auth_roles_1.assignStaffRole; } });
var pickup_verify_1 = require("./pickup_verify");
Object.defineProperty(exports, "verifyPickup", { enumerable: true, get: function () { return pickup_verify_1.verifyPickup; } });
//# sourceMappingURL=index.js.map