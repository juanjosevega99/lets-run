// @garmin/fitsdk ships .d.ts files, but they use extensionless relative imports that
// don't resolve under moduleResolution: NodeNext — every re-export comes back empty.
// This ambient declaration overrides them with the minimal surface we use.
declare module "@garmin/fitsdk" {
  export const Stream: {
    fromBuffer(buffer: Buffer | Uint8Array): unknown;
  };

  export class Decoder {
    constructor(stream: unknown);
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(options?: Record<string, unknown>): {
      messages: Record<string, any[]>;
      errors: unknown[];
    };
  }

  export class Encoder {
    constructor(options?: Record<string, unknown>);
    writeMesg(mesg: Record<string, unknown> & { mesgNum: number }): this;
    close(): Uint8Array;
  }

  export const Profile: {
    MesgNum: { FILE_ID: number; RECORD: number } & Record<string, number>;
  };

  export const Utils: {
    FIT_EPOCH_MS: number;
    convertDateToDateTime(date: Date): number;
    convertDateTimeToDate(datetime: number): Date;
  };
}
