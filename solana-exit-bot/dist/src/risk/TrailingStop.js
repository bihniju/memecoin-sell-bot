export const isTrailingActive = (position, activationPct) => {
    const activationPrice = position.entryPrice * (1 + activationPct / 100);
    return position.highestPrice >= activationPrice;
};
export const trailingStopPrice = (position, trailingStopPct) => position.highestPrice * (1 - trailingStopPct / 100);
export const shouldTriggerTrailingStop = (position, activationPct, trailingStopPct) => {
    if (!isTrailingActive(position, activationPct))
        return false;
    return position.currentPrice <= trailingStopPrice(position, trailingStopPct);
};
