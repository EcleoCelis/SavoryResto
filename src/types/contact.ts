export interface ContactInquiryPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactInquiryResponse {
  message: string;
}
