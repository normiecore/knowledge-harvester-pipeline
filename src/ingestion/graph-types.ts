export interface GraphUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
  department?: string;
}

/** Paginated response from the /users endpoint. */
export interface GraphPagedResponse<T> {
  '@odata.nextLink'?: string;
  value: T[];
}

export interface GraphDeltaResponse<T> {
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
  value: T[];
}

export interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: { contentType: string; content: string };
  from?: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  isRead?: boolean;
}

export interface GraphChatMessage {
  id: string;
  messageType: string;
  body: { contentType: string; content: string };
  from?: { user?: { displayName: string; id: string } };
  createdDateTime: string;
  chatId?: string;
  channelIdentity?: { teamId: string; channelId: string };
}

export interface GraphCalendarEvent {
  id: string;
  subject: string;
  bodyPreview: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  organizer?: { emailAddress: { name: string; address: string } };
  attendees?: Array<{ emailAddress: { name: string; address: string }; type: string }>;
  isAllDay?: boolean;
}

export interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  lastModifiedBy?: {
    user?: { displayName: string; id: string; email?: string };
  };
  parentReference?: {
    driveId?: string;
    path?: string;
  };
  file?: { mimeType: string; hashes?: { sha256Hash?: string } };
  folder?: { childCount: number };
  size?: number;
}
