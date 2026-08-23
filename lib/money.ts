export function rupeesToPaise(value: number) {
  return Math.round(value * 100);
}

export function paiseToRupees(value: number) {
  return value / 100;
}
