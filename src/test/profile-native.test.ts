import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getPhoto: vi.fn(), addListener: vi.fn() }));
vi.mock("@capacitor/camera", () => ({ Camera: { getPhoto: mocks.getPhoto }, CameraResultType: { Base64: "base64" }, CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" }, CameraDirection: { Front: "FRONT" } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: mocks.addListener } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { chooseNativeProfilePhoto, onProfilePhotoRestored } from "@/lib/native";

describe("Android profile photo path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, { Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } });
    mocks.getPhoto.mockResolvedValue({ base64String: btoa("image bytes"), format: "jpeg" });
  });
  it.each(["camera", "gallery"] as const)("returns %s photos to the app without native editing or data URL fetch", async (source) => {
    const file = await chooseNativeProfilePhoto(source);
    expect(file?.size).toBe(11);
    expect(file?.type).toBe("image/jpeg");
    expect(mocks.getPhoto).toHaveBeenCalledWith(expect.objectContaining({ source: source === "camera" ? "CAMERA" : "PHOTOS", resultType: "base64", allowEditing: false }));
  });
  it("recovers camera data after Android recreates the app", async () => {
    const callback = vi.fn(); const remove = vi.fn();
    mocks.addListener.mockResolvedValue({ remove });
    const stop = await onProfilePhotoRestored(callback);
    const handler = mocks.addListener.mock.calls[0]?.[1];
    handler({ pluginId: "Camera", methodName: "getPhoto", success: true, data: { base64String: btoa("image bytes"), format: "jpeg" } });
    expect(callback.mock.calls[0]?.[0]?.size).toBe(11);
    stop(); expect(remove).toHaveBeenCalledOnce();
  });
  it("does not silently treat a missing native photo as a successful capture", async () => {
    mocks.getPhoto.mockResolvedValue({ format: "jpeg" });
    await expect(chooseNativeProfilePhoto("camera")).rejects.toThrow("Camera returned no image");
  });
});