declare module "qrcode" {
  export type QrCodeOptions = {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  };

  export function toDataURL(text: string, options?: QrCodeOptions): Promise<string>;
}
