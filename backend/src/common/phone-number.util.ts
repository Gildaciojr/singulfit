const BRAZIL_COUNTRY_CODE = '55';

export function normalizeBrazilianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 10 || digits.length === 11) {
    return `+${BRAZIL_COUNTRY_CODE}${digits}`;
  }

  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith(BRAZIL_COUNTRY_CODE)
  ) {
    return `+${digits}`;
  }

  return null;
}

export function phoneFromRemoteJid(remoteJid: string): string | null {
  const [address, domain] = remoteJid.trim().toLowerCase().split('@', 2);

  if (
    !address ||
    !domain ||
    domain === 'g.us' ||
    domain === 'broadcast' ||
    domain === 'lid'
  ) {
    return null;
  }

  return normalizeBrazilianPhone(address.split(':', 1)[0]);
}
