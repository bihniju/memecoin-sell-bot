export const stopLossPrice = (position, stopLossPct) => position.entryPrice * (1 - stopLossPct / 100);
export const shouldTriggerStopLoss = (position, stopLossPct) => {
    const stop = stopLossPrice(position, stopLossPct);
    return position.currentPrice <= stop;
};
