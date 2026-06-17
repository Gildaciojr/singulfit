import { CoachAdminController } from './coach-admin.controller';
import { CoachExperienceService } from './coach-experience.service';
import { CoachIntelligenceService } from './coach-intelligence.service';

describe('CoachAdminController', () => {
  it('delegates all coach admin endpoints', async () => {
    const coach = {
      listUsers: jest.fn().mockResolvedValue({ items: [] }),
      listEngagement: jest.fn().mockResolvedValue({ items: [] }),
      listChurn: jest.fn().mockResolvedValue({ items: [] }),
      listReviews: jest.fn().mockResolvedValue({ items: [] }),
    };
    const experience = {
      listProfiles: jest.fn().mockResolvedValue({ items: [] }),
      listFatigue: jest.fn().mockResolvedValue({ items: [] }),
      listMomentum: jest.fn().mockResolvedValue({ items: [] }),
      listRetention: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new CoachAdminController(
      coach as unknown as CoachIntelligenceService,
      experience as unknown as CoachExperienceService,
    );
    const query = { limit: 25 };

    await controller.listUsers(query);
    await controller.listEngagement(query);
    await controller.listChurn(query);
    await controller.listReviews(query);
    await controller.listProfiles(query);
    await controller.listFatigue(query);
    await controller.listMomentum(query);
    await controller.listRetention(query);

    expect(coach.listUsers).toHaveBeenCalledWith(query);
    expect(coach.listEngagement).toHaveBeenCalledWith(query);
    expect(coach.listChurn).toHaveBeenCalledWith(query);
    expect(coach.listReviews).toHaveBeenCalledWith(query);
    expect(experience.listProfiles).toHaveBeenCalledWith(query);
    expect(experience.listFatigue).toHaveBeenCalledWith(query);
    expect(experience.listMomentum).toHaveBeenCalledWith(query);
    expect(experience.listRetention).toHaveBeenCalledWith(query);
  });
});
