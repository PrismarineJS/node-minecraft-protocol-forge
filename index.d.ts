/// <reference types="node" />
import {
  PingOptions as VanillaPingOptions,
  OldPingResult as VanillaOldPingResult,
  NewPingResult as VanillaNewPingResult,
} from 'minecraft-protocol';

declare module 'minecraft-protocol-forge' {

  export type OldPingResult = VanillaOldPingResult

  export type NewPingResult = VanillaNewPingResult

  export interface PingOptions extends VanillaPingOptions {
    deserializeForgeData?: boolean;
    overrideForgeData?: boolean;
  }

  export interface FMLPingResult extends NewPingResult {
    modinfo: {
      type: string;
      modList: {
        modid: string;
        version: string;
      }[];
    };
  }

  export interface FML2PingResult extends NewPingResult {
    forgeData: {
      channels: {
        res: string;
        version: string;
        required: boolean;
      }[];
      mods: {
        modId: string;
        modmarker: string;
      }[];
      fmlNetworkVersion: 2;
    };
  }

  interface FML3Mod {
    modId: string;
    modVersion?: string;
  }

  interface FML3Channel {
    channelName: string;
    channelVersion: string;
    requiredOnClient: boolean;
  }

  export interface FML3PingResult extends NewPingResult {
    forgeData: {
      channels: [];
      mods: [];
      truncated: boolean;
      fmlNetworkVersion: 3;
      d: {
        truncated: boolean;
        mods: (FML3Mod & {
          channels: FML3Channel[];
        })[];
        nonModChannels: FML3Channel[];
      };
    };
  }

  export interface FML3PingResultOverride extends NewPingResult {
    forgeData: {
      channels: FML3Channel[];
      mods: FML3Mod[];
      truncated: boolean;
      fmlNetworkVersion: 3;
    };
  }

  type PingResult =
    | OldPingResult
    | NewPingResult
    | FMLPingResult
    | FML2PingResult
    | FML3PingResult
    | FML3PingResultOverride;

  export function ping(
    options: PingOptions,
    callback?: (error: Error, result: PingResult) => void
  ): Promise<PingResult>;
}
