/**
 * Shared customer/order dataset for demo APIs.
 * Persisted on globalThis so analytics, chat, and customers stay consistent.
 */

import { generateCustomers, generateOrders, type SyntheticCustomer } from './seed-data';

type OrderRecord = ReturnType<typeof generateOrders>[number];

declare global {
  // eslint-disable-next-line no-var
  var _pulseCustomerData: SyntheticCustomer[] | undefined;
  // eslint-disable-next-line no-var
  var _pulseOrderData: OrderRecord[] | undefined;
}

export function getCustomerData(): SyntheticCustomer[] {
  if (!globalThis._pulseCustomerData) {
    globalThis._pulseCustomerData = generateCustomers(300);
    globalThis._pulseOrderData = generateOrders(globalThis._pulseCustomerData);
  }
  return globalThis._pulseCustomerData;
}

export function getOrderData(): OrderRecord[] {
  if (!globalThis._pulseOrderData) {
    getCustomerData();
  }
  return globalThis._pulseOrderData!;
}

export function resetCustomerData(): { customerCount: number; orderCount: number } {
  globalThis._pulseCustomerData = generateCustomers(300);
  globalThis._pulseOrderData = generateOrders(globalThis._pulseCustomerData);
  return {
    customerCount: globalThis._pulseCustomerData.length,
    orderCount: globalThis._pulseOrderData.length,
  };
}

export function appendCustomerData(customers: SyntheticCustomer[], orders: OrderRecord[]) {
  globalThis._pulseCustomerData = [...getCustomerData(), ...customers];
  globalThis._pulseOrderData = [...getOrderData(), ...orders];
}
