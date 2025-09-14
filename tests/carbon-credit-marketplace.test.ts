import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_PRICE = 102;
const ERR_LISTING_NOT_FOUND = 104;
const ERR_INSUFFICIENT_BALANCE = 105;
const ERR_NOT_OWNER = 108;
const ERR_INVALID_MINTER = 118;
const ERR_MAX_SUPPLY_EXCEEDED = 117;
const ERR_AUCTION_NOT_FOUND = 123;
const ERR_BID_TOO_LOW = 124;
const ERR_AUCTION_ENDED = 125;
const ERR_AUCTION_ACTIVE = 126;

interface Listing {
  seller: string;
  amount: number;
  price: number;
}

interface Auction {
  seller: string;
  amount: number;
  startPrice: number;
  reservePrice: number;
  endTime: number;
  highestBid: number;
  highestBidder: string | null;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class CarbonCreditMarketplaceMock {
  state: {
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    tokenUri: string;
    totalSupply: number;
    minter: string;
    nextListingId: number;
    nextAuctionId: number;
    balances: Map<string, number>;
    allowances: Map<string, number>;
    listings: Map<number, Listing>;
    auctions: Map<number, Auction>;
    retiredCredits: Map<string, number>;
  } = {
    tokenName: "CarbonCredit",
    tokenSymbol: "CC",
    tokenDecimals: 6,
    tokenUri: "https://example.com/carbon-credit",
    totalSupply: 0,
    minter: "ST1TEST",
    nextListingId: 0,
    nextAuctionId: 0,
    balances: new Map(),
    allowances: new Map(),
    listings: new Map(),
    auctions: new Map(),
    retiredCredits: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];
  maxSupply: number = 1000000000;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      tokenName: "CarbonCredit",
      tokenSymbol: "CC",
      tokenDecimals: 6,
      tokenUri: "https://example.com/carbon-credit",
      totalSupply: 0,
      minter: "ST1TEST",
      nextListingId: 0,
      nextAuctionId: 0,
      balances: new Map(),
      allowances: new Map(),
      listings: new Map(),
      auctions: new Map(),
      retiredCredits: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  getBalance(account: string): Result<number> {
    return { ok: true, value: this.state.balances.get(account) || 0 };
  }

  getTotalSupply(): Result<number> {
    return { ok: true, value: this.state.totalSupply };
  }

  mint(amount: number, recipient: string): Result<boolean> {
    if (this.caller !== this.state.minter) return { ok: false, value: ERR_INVALID_MINTER };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (this.state.totalSupply + amount > this.maxSupply) return { ok: false, value: ERR_MAX_SUPPLY_EXCEEDED };
    const current = this.state.balances.get(recipient) || 0;
    this.state.balances.set(recipient, current + amount);
    this.state.totalSupply += amount;
    return { ok: true, value: true };
  }

  transfer(amount: number, recipient: string): Result<boolean> {
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const senderBalance = this.state.balances.get(this.caller) || 0;
    if (senderBalance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const recipientBalance = this.state.balances.get(recipient) || 0;
    this.state.balances.set(this.caller, senderBalance - amount);
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  listCredits(amount: number, price: number): Result<number> {
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (price <= 0) return { ok: false, value: ERR_INVALID_PRICE };
    const balance = this.state.balances.get(this.caller) || 0;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.balances.set(this.caller, balance - amount);
    const contractBalance = this.state.balances.get("contract") || 0;
    this.state.balances.set("contract", contractBalance + amount);
    const id = this.state.nextListingId;
    this.state.listings.set(id, { seller: this.caller, amount, price });
    this.state.nextListingId++;
    return { ok: true, value: id };
  }

  buyCredits(listingId: number, amount: number): Result<boolean> {
    const listing = this.state.listings.get(listingId);
    if (!listing) return { ok: false, value: ERR_LISTING_NOT_FOUND };
    if (amount > listing.amount || amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const cost = listing.price * amount;
    this.stxTransfers.push({ amount: cost, from: this.caller, to: listing.seller });
    const contractBalance = this.state.balances.get("contract") || 0;
    this.state.balances.set("contract", contractBalance - amount);
    const buyerBalance = this.state.balances.get(this.caller) || 0;
    this.state.balances.set(this.caller, buyerBalance + amount);
    if (amount === listing.amount) {
      this.state.listings.delete(listingId);
    } else {
      this.state.listings.set(listingId, { ...listing, amount: listing.amount - amount });
    }
    return { ok: true, value: true };
  }

  retireCredits(amount: number): Result<boolean> {
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const balance = this.state.balances.get(this.caller) || 0;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.balances.set(this.caller, balance - amount);
    const retired = this.state.retiredCredits.get(this.caller) || 0;
    this.state.retiredCredits.set(this.caller, retired + amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  createAuction(amount: number, startPrice: number, reservePrice: number, duration: number): Result<number> {
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (startPrice <= 0) return { ok: false, value: ERR_INVALID_PRICE };
    if (reservePrice > startPrice) return { ok: false, value: ERR_INVALID_PRICE };
    if (duration <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const balance = this.state.balances.get(this.caller) || 0;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.balances.set(this.caller, balance - amount);
    const contractBalance = this.state.balances.get("contract") || 0;
    this.state.balances.set("contract", contractBalance + amount);
    const id = this.state.nextAuctionId;
    this.state.auctions.set(id, { seller: this.caller, amount, startPrice, reservePrice, endTime: this.blockHeight + duration, highestBid: 0, highestBidder: null });
    this.state.nextAuctionId++;
    return { ok: true, value: id };
  }

  placeBid(auctionId: number, bidAmount: number): Result<boolean> {
    const auction = this.state.auctions.get(auctionId);
    if (!auction) return { ok: false, value: ERR_AUCTION_NOT_FOUND };
    if (this.blockHeight >= auction.endTime) return { ok: false, value: ERR_AUCTION_ENDED };
    if (bidAmount <= auction.highestBid) return { ok: false, value: ERR_BID_TOO_LOW };
    this.stxTransfers.push({ amount: bidAmount, from: this.caller, to: "contract" });
    if (auction.highestBidder) {
      this.stxTransfers.push({ amount: auction.highestBid, from: "contract", to: auction.highestBidder });
    }
    this.state.auctions.set(auctionId, { ...auction, highestBid: bidAmount, highestBidder: this.caller });
    return { ok: true, value: true };
  }

  endAuction(auctionId: number): Result<boolean> {
    const auction = this.state.auctions.get(auctionId);
    if (!auction) return { ok: false, value: ERR_AUCTION_NOT_FOUND };
    if (this.blockHeight < auction.endTime) return { ok: false, value: ERR_AUCTION_ACTIVE };
    if (auction.highestBid >= auction.reservePrice && auction.highestBidder) {
      this.stxTransfers.push({ amount: auction.highestBid, from: "contract", to: auction.seller });
      const contractBalance = this.state.balances.get("contract") || 0;
      this.state.balances.set("contract", contractBalance - auction.amount);
      const bidderBalance = this.state.balances.get(auction.highestBidder) || 0;
      this.state.balances.set(auction.highestBidder, bidderBalance + auction.amount);
    } else {
      const contractBalance = this.state.balances.get("contract") || 0;
      this.state.balances.set("contract", contractBalance - auction.amount);
      const sellerBalance = this.state.balances.get(auction.seller) || 0;
      this.state.balances.set(auction.seller, sellerBalance + auction.amount);
      if (auction.highestBidder) {
        this.stxTransfers.push({ amount: auction.highestBid, from: "contract", to: auction.highestBidder });
      }
    }
    this.state.auctions.delete(auctionId);
    return { ok: true, value: true };
  }
}

describe("CarbonCreditMarketplace", () => {
  let contract: CarbonCreditMarketplaceMock;

  beforeEach(() => {
    contract = new CarbonCreditMarketplaceMock();
    contract.reset();
  });

  it("mints tokens successfully", () => {
    const result = contract.mint(1000, "ST2TEST");
    expect(result.ok).toBe(true);
    const balance = contract.getBalance("ST2TEST");
    expect(balance.value).toBe(1000);
    const supply = contract.getTotalSupply();
    expect(supply.value).toBe(1000);
  });

  it("rejects mint by non-minter", () => {
    contract.caller = "ST3FAKE";
    const result = contract.mint(1000, "ST2TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MINTER);
  });

  it("transfers tokens successfully", () => {
    contract.mint(1000, "ST1TEST");
    const result = contract.transfer(500, "ST2TEST");
    expect(result.ok).toBe(true);
    const balance1 = contract.getBalance("ST1TEST");
    expect(balance1.value).toBe(500);
    const balance2 = contract.getBalance("ST2TEST");
    expect(balance2.value).toBe(500);
  });

  it("rejects transfer with insufficient balance", () => {
    contract.mint(1000, "ST1TEST");
    const result = contract.transfer(1500, "ST2TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("lists credits successfully", () => {
    contract.mint(1000, "ST1TEST");
    const result = contract.listCredits(500, 10);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const balance = contract.getBalance("ST1TEST");
    expect(balance.value).toBe(500);
  });

  it("buys credits successfully", () => {
    contract.mint(1000, "ST2TEST");
    contract.caller = "ST2TEST";
    contract.listCredits(500, 10);
    contract.caller = "ST1TEST";
    const result = contract.buyCredits(0, 200);
    expect(result.ok).toBe(true);
    const balance = contract.getBalance("ST1TEST");
    expect(balance.value).toBe(200);
  });

  it("retires credits successfully", () => {
    contract.mint(1000, "ST1TEST");
    const result = contract.retireCredits(500);
    expect(result.ok).toBe(true);
    const balance = contract.getBalance("ST1TEST");
    expect(balance.value).toBe(500);
    const supply = contract.getTotalSupply();
    expect(supply.value).toBe(500);
  });

  it("creates auction successfully", () => {
    contract.mint(1000, "ST1TEST");
    const result = contract.createAuction(500, 100, 50, 10);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
  });

  it("places bid successfully", () => {
    contract.mint(1000, "ST2TEST");
    contract.caller = "ST2TEST";
    contract.createAuction(500, 100, 50, 10);
    contract.caller = "ST1TEST";
    const result = contract.placeBid(0, 120);
    expect(result.ok).toBe(true);
  });

  it("ends auction successfully", () => {
    contract.mint(1000, "ST2TEST");
    contract.caller = "ST2TEST";
    contract.createAuction(500, 100, 50, 10);
    contract.caller = "ST1TEST";
    contract.placeBid(0, 120);
    contract.blockHeight = 11;
    const result = contract.endAuction(0);
    expect(result.ok).toBe(true);
    const balance = contract.getBalance("ST1TEST");
    expect(balance.value).toBe(500);
  });
});