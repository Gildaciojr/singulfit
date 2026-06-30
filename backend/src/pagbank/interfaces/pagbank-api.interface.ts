export interface PagBankCreateOrderRequest {
  reference_id: string;
  customer: {
    name: string;
    email: string;
    tax_id: string;
    phones: Array<{
      country: string;
      area: string;
      number: string;
      type: 'MOBILE';
    }>;
  };
  items: Array<{
    reference_id: string;
    name: string;
    quantity: number;
    unit_amount: number;
  }>;
  notification_urls?: string[];
  qr_codes?: Array<{
    amount: {
      value: number;
    };
    expiration_date: string;
  }>;
  charges?: Array<{
    reference_id: string;
    description: string;
    amount: {
      value: number;
      currency: 'BRL';
    };
    payment_method: {
      type: 'CREDIT_CARD';
      installments: number;
      capture: true;
      card: {
        encrypted: string;
        store: false;
      };
      holder: {
        name: string;
        tax_id: string;
      };
    };
  }>;
}

export interface PagBankLink {
  rel: string;
  href: string;
}

export interface PagBankQrCode {
  id: string;
  expiration_date: string;
  text: string;
  links: PagBankLink[];
}

export interface PagBankCreateOrderResponse {
  id: string;
  reference_id: string;
  qr_codes: PagBankQrCode[];
}

export interface PagBankCharge {
  id: string;
  reference_id: string;
  status: string;
  paid_at?: string;
  amount: {
    value: number;
    currency: string;
  };
  payment_response?: {
    code?: string;
    message?: string;
  };
  payment_method?: {
    card?: {
      brand?: string;
      last_digits?: string;
    };
  };
}

export interface PagBankOrderResponse {
  id: string;
  reference_id: string;
  charges: PagBankCharge[];
}
